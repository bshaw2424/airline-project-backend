"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

mongoose.set("strictQuery", false);

// Validate the application environment.
const NODE_ENV = process.env.NODE_ENV || "development";

if (!["development", "production"].includes(NODE_ENV)) {
  throw new Error(`Invalid NODE_ENV: ${NODE_ENV}`);
}

// Select the correct MongoDB database.
const DB_NAME = NODE_ENV === "production" ? "undefined" : "flightinrange_dev";

const MONGODB_URL =
  `mongodb+srv://${encodeURIComponent(process.env.DB_USERNAME)}:` +
  `${encodeURIComponent(process.env.DB_PASSWORD)}` +
  `@airline-project-cluster.5z5h2wm.mongodb.net/${DB_NAME}` +
  `?appName=airline-project-cluster`;

const databaseConnection = mongoose
  .connect(MONGODB_URL, {
    serverSelectionTimeoutMS: 10000,
  })
  .then(() => {
    console.log("Database connected");
  })
  .catch(err => {
    console.error("Database connection error:", err.message);

    if (err.reason?.servers) {
      for (const [server, description] of err.reason.servers) {
        console.log(`\nServer: ${server}`);
        console.log("Server error:", description.error);
      }
    }

    throw err;
  });

module.exports = {
  databaseConnection,
  MONGODB_URL,
};
