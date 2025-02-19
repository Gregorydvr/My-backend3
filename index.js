// index.js
const express = require("express");
const fetch = require("node-fetch").default; // <-- IMPORTANT: .default for node-fetch v3
const cron = require("node-cron");

const app = express();
app.use(express.json());

// Motivational quotes from quotes.js
const motivationalQuotes = [
  "Success is not final, failure is not fatal: It is the courage to continue that counts. – Winston Churchill",
  "Believe you can, and you're halfway there. – Theodore Roosevelt",
  "I have not failed. I've just found 10,000 ways that won't work. – Thomas Edison",
  "Opportunities don't happen. You create them. – Chris Grosser",
  "Don’t watch the clock; do what it does. Keep going. – Sam Levenson",
  "You miss 100% of the shots you don't take. – Wayne Gretzky",
  "Do what you can with all you have, wherever you are. – Theodore Roosevelt",
  "Success usually comes to those who are too busy to be looking for it. – Henry David Thoreau"
];

// In-memory storage for user preferences and notification tracking
let userPreferences = [];

// -----------------------------------------------
// Endpoint to receive user preferences from the Expo app
// -----------------------------------------------
app.post("/schedule", (req, res) => {
  try {
    const prefs = req.body;
    console.log("Received new preferences:", prefs);

    const index = userPreferences.findIndex(
      (u) => u.expoPushToken === prefs.expoPushToken
    );
    if (index >= 0) {
      // Update existing user
      const user = userPreferences[index];
      user.motivationEnabled = prefs.motivationEnabled;
      user.screenTimeEnabled = prefs.screenTimeEnabled;
      user.nudgeEnabled = prefs.nudgeEnabled;
      user.screenTime = prefs.screenTime;
      user.nudgeTime = prefs.nudgeTime;

      // Initialize or reset screen time tracking if toggled on/off
      if (user.screenTimeEnabled) {
        if (!user.screenTimeStart) {
          user.screenTimeStart = new Date();
          user.screenTimeCount = 0;
        }
      } else {
        user.screenTimeStart = null;
        user.screenTimeCount = 0;
      }

      // Initialize or reset nudge tracking if toggled on/off
      if (user.nudgeEnabled) {
        if (!user.lastNudgeSent) {
          user.lastNudgeSent = new Date();
          user.lastSpecialNudgeSent = null;
        }
      } else {
        user.lastNudgeSent = null;
        user.lastSpecialNudgeSent = null;
      }

      // For motivational quotes, ensure usedQuotes array exists if motivation is enabled
      if (user.motivationEnabled && !user.usedQuotes) {
        user.usedQuotes = [];
      }
    } else {
      // Add new user
      const newUser = {
        ...prefs,
        usedQuotes: prefs.motivationEnabled ? [] : [],
        screenTimeStart: prefs.screenTimeEnabled ? new Date() : null,
        screenTimeCount: 0,
        lastNudgeSent: prefs.nudgeEnabled ? new Date() : null,
        lastSpecialNudgeSent: null,
        lastActive: null,
      };
      userPreferences.push(newUser);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in /schedule route:", error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

// -----------------------------------------------
// Endpoint to update app state (for A Nudge notifications)
// -----------------------------------------------
app.post("/appstate", (req, res) => {
  try {
    const { expoPushToken, lastActive, appState } = req.body;
    console.log("Received app state update:", expoPushToken, appState, lastActive);

    const user = userPreferences.find((u) => u.expoPushToken === expoPushToken);
    if (user) {
      user.lastActive = new Date(lastActive);
      res.json({ success: true, message: "App state updated" });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error in /appstate:", error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

// -----------------------------------------------
// Helper function to send a push notification via Expo
// -----------------------------------------------
async function sendPushNotification(expoPushToken, title, body, vibrate) {
  try {
    const soundSetting = vibrate ? "default" : undefined;
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

// -----------------------------------------------
// CRON job: Check every minute to decide whether to send notifications
// -----------------------------------------------
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // --- Motivation Notifications (at 10:00 and 14:00) ---
  if ((currentHour === 10 && currentMinute === 0) || (currentHour === 14 && currentMinute === 0)) {
    for (const user of userPreferences) {
      if (user.motivationEnabled) {
        let availableQuotes = motivationalQuotes.filter(
          (q) => !user.usedQuotes.includes(q)
        );
        if (availableQuotes.length === 0) {
          user.usedQuotes = [];
          availableQuotes = motivationalQuotes;
        }
        const randomIndex = Math.floor(Math.random() * availableQuotes.length);
        const selectedQuote = availableQuotes[randomIndex];
        user.usedQuotes.push(selectedQuote);

        await sendPushNotification(
          user.expoPushToken,
          "✨ Daily Motivation",
          selectedQuote,
          true // vibrate
        );
      }
    }
  }

  // --- Screen Time Notifications ---
  for (const user of userPreferences) {
    if (user.screenTimeEnabled && user.screenTimeStart) {
      const elapsedMs = now - new Date(user.screenTimeStart);
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      // If enough hours have passed since the last notification
      if (elapsedHours >= (user.screenTimeCount + 1) * user.screenTime) {
        let message = "";
        if (user.screenTimeCount === 0) {
          message = `You have spent ${user.screenTime} hour${
            user.screenTime > 1 ? "s" : ""
          } on your phone`;
        } else {
          message = `You have spent another ${user.screenTime} hour${
            user.screenTime > 1 ? "s" : ""
          } on your phone`;
        }

        await sendPushNotification(
          user.expoPushToken,
          "📱 Screen Time",
          message,
          true // vibrate
        );
        user.screenTimeCount += 1;
      }
    }
  }

  // --- A Nudge Notifications (only if app is considered closed) ---
  // We consider the app "closed" if the last activity update is more than 5 minutes old.
  const appClosedThreshold = 5 * 60 * 1000; // 5 minutes in ms
  for (const user of userPreferences) {
    if (user.nudgeEnabled) {
      // Only send "A Nudge" between 09:00 and 19:00 local server time
      if (currentHour >= 9 && currentHour < 19) {
        const lastActive = user.lastActive ? new Date(user.lastActive) : null;
        if (!lastActive || now - lastActive > appClosedThreshold) {
          // Special daily nudge at 09:00 (sent only once per day)
          const todayStr = now.toDateString();
          if (
            currentHour === 9 &&
            currentMinute === 0 &&
            (!user.lastSpecialNudgeSent ||
              new Date(user.lastSpecialNudgeSent).toDateString() !== todayStr)
          ) {
            await sendPushNotification(
              user.expoPushToken,
              "Good Morning!",
              "It's a new day to not go on your phone",
              false // no vibration
            );
            user.lastSpecialNudgeSent = now;
          }

          // Repeated A Nudge notifications based on the chosen interval
          if (user.lastNudgeSent) {
            const elapsedMsNudge = now - new Date(user.lastNudgeSent);
            const intervalMs = user.nudgeTime * 60 * 60 * 1000;
            if (elapsedMsNudge >= intervalMs) {
              await sendPushNotification(
                user.expoPushToken,
                "A Nudge",
                "Tap this and take control of your screen time today",
                false // no vibration
              );
              user.lastNudgeSent = now;
            }
          } else {
            // If lastNudgeSent was null, set it now so the timer starts
            user.lastNudgeSent = now;
          }
        }
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend server running on port", PORT);
});
