const express = require("express");
const app = express();
const path = require("path");
const airlineRoutes = require("./routes/airlines");
const destinationRoutes = require("./routes/destinations");
require("./databaseConnect");
const methodOverride = require("method-override");
const PORT = process.env.port || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

app.use(express.static("public"));
app.use(methodOverride("_method"));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

app.use("/airline", airlineRoutes);
app.use("/airline/:slug/destinations", destinationRoutes);

app.listen(PORT, () => console.log(`server running on port ${PORT}`));
