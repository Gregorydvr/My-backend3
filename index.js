// index.js
const express = require("express");
const app = express();

// (1) Let’s parse JSON bodies if they come in
app.use(express.json());

// (2) A simple test route
app.get("/", (req, res) => {
  res.send("Hello from my-backend!");
});

// (3) Start the server
const PORT = process.env.PORT || 3002; 
// ^ this means: if Railway sets PORT in the environment, use that. Otherwise, default to 3000.

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
