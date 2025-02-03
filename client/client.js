const { app, Menu, Tray, BrowserWindow, Notification } = require("electron");
const axios = require("axios");
const WebSocket = require("ws");

let tray = null;
let mainWindow = null;
const SERVER_URL = "https://localhost:4000";
const WS_URL = "wss://localhost:4000";
let ws;
let userId = null;

async function login() {
    try {
        const response = await axios.get(`${SERVER_URL}/login`);
        userId = response.data.userId;
        require("open")(response.data.authUrl);
    } catch (error) {
        console.error("Login error:", error);
    }
}

function setupWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.on("open", () => console.log("WebSocket connected"));
    
    ws.on("message", (data) => {
        const message = JSON.parse(data);
        if (message.type === "update-incidents") {
            mainWindow.webContents.send("update-incidents", message.data);
            showNotification(message.data.length);
        }
    });

    ws.on("close", () => {
        console.log("WebSocket disconnected, retrying in 5 seconds...");
        setTimeout(setupWebSocket, 5000);
    });
}

app.whenReady().then(() => {
    tray = new Tray("icon.png");
    const contextMenu = Menu.buildFromTemplate([
        { label: "Login", click: login },
        { label: "Exit", click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);

    mainWindow = new BrowserWindow({ width: 400, height: 500, webPreferences: { nodeIntegration: true } });
    mainWindow.loadFile("popup.html");

    setupWebSocket();
});