"use strict";
require("dotenv").config();
const mongoose = require("mongoose");

mongoose.Promise = global.Promise;
const MONGODB_URL =
  "mongodb+srv://airline-personal-project-2022:project2022@airline-project-cluster.5z5h2wm.mongodb.net/?retryWrites=true&w=majority";
const databaseConnection = mongoose
  .connect(MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Database connected"))
  .catch(err => console.log(`Error: ${err.message}`));

module.exports = databaseConnection;
