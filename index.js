// index.js
const express = require("express");
const fetch = require("node-fetch");
const cron = require("node-cron");

// In a real app, you'd store user data in a database.
// For demo, we'll keep it in memory.
let userPreferences = [];

// Start Express
const app = express();
app.use(express.json());

// 1) Endpoint to receive user preferences from the Expo app
app.post("/schedule", (req, res) => {
  try {
    const prefs = req.body;
    console.log("Received new preferences:", prefs);

    const existingIndex = userPreferences.findIndex(
      (u) => u.expoPushToken === prefs.expoPushToken
    );
    if (existingIndex >= 0) {
      // Update existing user’s preferences
      userPreferences[existingIndex] = prefs;
    } else {
      // Add new user
      userPreferences.push(prefs);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in /schedule route:", error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

// 2) CRON job: check every minute to see if it's time to send push notifications
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Example: If 10:00 or 14:00, send a "motivation" notification
  if ((currentHour === 10 && currentMinute === 0) ||
      (currentHour === 14 && currentMinute === 0)) {
    for (const user of userPreferences) {
      if (user.motivationEnabled) {
        await sendPushNotification(
          user.expoPushToken,
          "✨ Daily Motivation",
          "This is where you'd include a random quote",
          true // vibrate
        );
      }
    }
  }

  // Check other conditions for Screen Time, A Nudge, etc., as needed
  // ...
});

// 3) Helper function to actually send a push via Expo
async function sendPushNotification(expoPushToken, title, body, vibrate) {
  try {
    const soundSetting = vibrate ? "default" : undefined;
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        to: expoPushToken,
        sound: soundSetting,
        title,
        body,
        data: { extra: "info" },
      }),
    });
    const result = await response.json();
    console.log("Push response:", result);
  } catch (error) {
    console.error("Error sending push:", error);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend server running on port", PORT);
});
