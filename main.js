const { app, Menu, Tray, BrowserWindow, Notification } = require("electron");
const axios = require("axios");
const keytar = require("keytar");
const { OAuth2 } = require("oauth2-client-js");
const express = require("express");
const open = require("open");
const path = require("path");

const SERVICE_NOW_INSTANCE = "https://your-instance.service-now.com";
const OKTA_CLIENT_ID = "your-okta-client-id";
const OKTA_CLIENT_SECRET = "your-okta-client-secret";
const OKTA_AUTH_URL = "https://your-okta-domain/oauth2/default/v1/authorize";
const OKTA_TOKEN_URL = "https://your-okta-domain/oauth2/default/v1/token";
const REDIRECT_URI = "http://localhost:3000/callback";

let tray = null;
let mainWindow = null;
let accessToken = null;

// Start Express server for OAuth callback
const server = express();
server.get("/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send("Authorization failed.");

    try {
        const tokenResponse = await axios.post(OKTA_TOKEN_URL, new URLSearchParams({
            grant_type: "authorization_code",
            client_id: OKTA_CLIENT_ID,
            client_secret: OKTA_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            code
        }).toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        accessToken = tokenResponse.data.access_token;
        await keytar.setPassword("servicenow-app", "access_token", accessToken);
        res.send("Authorization successful. You can close this window.");
    } catch (error) {
        console.error("OAuth Token Error:", error);
        res.send("Authentication failed.");
    }
});
server.listen(3000, () => console.log("OAuth callback listening on port 3000"));

async function authenticate() {
    accessToken = await keytar.getPassword("servicenow-app", "access_token");

    if (!accessToken) {
        const authUrl = `${OKTA_AUTH_URL}?client_id=${OKTA_CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=openid profile`;
        await open(authUrl);
    }
}

async function fetchIncidents() {
    if (!accessToken) return [];

    try {
        const response = await axios.get(`${SERVICE_NOW_INSTANCE}/api/now/table/incident`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });

        return response.data.result.map(incident => ({
            sys_id: incident.sys_id, // Add sys_id for linking
            short_description: incident.short_description || "No Description",
            state: incident.state || "Unknown",
            priority: incident.priority || "3", // Default to Low (3)
            opened_at: incident.opened_at || new Date().toISOString()
        }));
    } catch (error) {
        console.error("ServiceNow API Error:", error);
        return [];
    }
}


async function updateTray() {
    const incidents = await fetchIncidents();
    const count = incidents.length;
    tray.setToolTip(`Incidents: ${count}`);
    new Notification({ title: "ServiceNow", body: `Updated Incidents: ${count}` }).show();

    if (mainWindow) {
        mainWindow.webContents.send("update-incidents", incidents);
    }
}

function createPopupWindow() {
    if (mainWindow) {
        mainWindow.show();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 400,
        height: 500,
        show: false,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "popup.html"));

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });
}

app.whenReady().then(async () => {
    tray = new Tray("icon.png");

    const contextMenu = Menu.buildFromTemplate([
        { label: "Open Dashboard", click: createPopupWindow },
        { label: "Refresh", click: updateTray },
        { label: "Re-authenticate", click: authenticate },
        { label: "Exit", click: () => app.quit() }
    ]);

    tray.setContextMenu(contextMenu);

    await authenticate();
    updateTray();
    setInterval(updateTray, 60000);
});
