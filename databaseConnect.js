"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

mongoose.set("strictQuery", false);

const MONGODB_URL =
  `mongodb+srv://${encodeURIComponent(process.env.DB_USERNAME)}:` +
  `${encodeURIComponent(process.env.DB_PASSWORD)}` +
  `@airline-project-cluster.5z5h2wm.mongodb.net/undefined` +
  `?appName=airline-project-cluster`;

const databaseConnection = mongoose
  .connect(MONGODB_URL)
  .then(() => {
    console.log("Database connected");
  })
  .catch(err => {
    console.error("Database connection error:", err);
    throw err;
  });

module.exports = {
  databaseConnection,
  MONGODB_URL,
};
