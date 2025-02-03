const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const WebSocket = require("ws");

const app = express();
app.use(express.json());
app.use(cors());

const httpsOptions = {
    key: fs.readFileSync("ssl/server.key"),
    cert: fs.readFileSync("ssl/server.cert"),
};

// Start HTTPS server and WebSocket server
const server = https.createServer(httpsOptions, app);
const wss = new WebSocket.Server({ server });

const OKTA_CLIENT_ID = "your-okta-client-id";
const OKTA_AUTH_URL = "https://your-okta-domain/oauth2/default/v1/authorize";
const OKTA_TOKEN_URL = "https://your-okta-domain/oauth2/default/v1/token";
const OKTA_USERINFO_URL = "https://your-okta-domain/oauth2/default/v1/userinfo";
const SERVICE_NOW_INSTANCE = "https://your-instance.service-now.com";
const REDIRECT_URI = "https://localhost:4000/callback";
const SCOPES = "openid profile offline_access";

const users = {};
let connectedClients = [];

// Generate PKCE Code Verifier & Challenge
function generatePKCE() {
    const codeVerifier = crypto.randomBytes(32).toString("hex");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    return { codeVerifier, codeChallenge };
}

// WebSocket connection for real-time updates
wss.on("connection", (ws) => {
    console.log("Client connected to WebSocket");
    connectedClients.push(ws);

    ws.on("close", () => {
        connectedClients = connectedClients.filter(client => client !== ws);
        console.log("Client disconnected");
    });
});

async function notifyClients(incidents) {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "update-incidents", data: incidents }));
        }
    });
}

// OAuth Login - Redirect user to Okta
app.get("/login", (req, res) => {
    const userId = uuidv4();
    const { codeVerifier, codeChallenge } = generatePKCE();

    users[userId] = { codeVerifier };

    const authUrl = `${OKTA_AUTH_URL}?client_id=${OKTA_CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${SCOPES}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${userId}`;

    res.json({ authUrl, userId });
});

// OAuth Callback - Exchange Code for Token
app.get("/callback", async (req, res) => {
    const { code, state: userId } = req.query;
    if (!code || !userId || !users[userId]?.codeVerifier) return res.status(400).send("Authorization failed.");

    try {
        const tokenResponse = await axios.post(OKTA_TOKEN_URL, new URLSearchParams({
            grant_type: "authorization_code",
            client_id: OKTA_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: users[userId].codeVerifier
        }).toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        users[userId].access_token = tokenResponse.data.access_token;
        users[userId].refresh_token = tokenResponse.data.refresh_token;

        res.json({ message: "Login successful", userId });
    } catch (error) {
        console.error("OAuth Token Error:", error);
        res.status(500).send("Authentication failed.");
    }
});

// Fetch User Info from Okta
app.get("/user", async (req, res) => {
    const { userId } = req.query;
    if (!users[userId]?.access_token) return res.status(401).send("Unauthorized");

    try {
        const response = await axios.get(OKTA_USERINFO_URL, {
            headers: { Authorization: `Bearer ${users[userId].access_token}` }
        });

        res.json(response.data);
    } catch (error) {
        console.error("Failed to fetch user info:", error);
        res.status(500).send("Error fetching user info");
    }
});

// Fetch Incidents from ServiceNow
app.get("/incidents", async (req, res) => {
    const { userId } = req.query;
    if (!users[userId]?.access_token) return res.status(401).send("Unauthorized");

    try {
        const response = await axios.get(`${SERVICE_NOW_INSTANCE}/api/now/table/incident`, {
            headers: { Authorization: `Bearer ${users[userId].access_token}`, Accept: "application/json" },
        });

        res.json(response.data.result);
        notifyClients(response.data.result);
    } catch (error) {
        console.error("ServiceNow API Error:", error);
        res.status(500).send("Error fetching incidents");
    }
});

// Logout
app.get("/logout", (req, res) => {
    const { userId } = req.query;
    if (!users[userId]) return res.status(401).send("User not logged in");

    delete users[userId];
    res.send("Logged out successfully.");
});

// Start HTTPS server with WebSocket support
server.listen(4000, () => {
    console.log("HTTPS & WebSocket server running on https://localhost:4000");
});
