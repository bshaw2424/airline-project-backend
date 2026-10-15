require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const methodOverride = require("method-override");
const session = require("express-session");
const MongoStore = require("connect-mongo");

const airlineRoutes = require("./routes/airlines");
const destinationRoutes = require("./routes/destinations");
const airlineApiRoutes = require("./routes/airlineApi");
const authRoutes = require("./routes/authRoutes");
const favoriteRoutes = require("./routes/favoriteRoutes");
const collectionRoutes = require("./routes/collectionRoutes");

const { databaseConnection, MONGODB_URL } = require("./databaseConnect");

const app = express();
const PORT = process.env.PORT || 8000;
const isProduction = process.env.NODE_ENV === "production";

// DigitalOcean runs the app behind a proxy.
if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static("public"));
app.use(methodOverride("_method"));

// Allow requests from your React frontend.
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);

// Store login sessions in MongoDB.
app.use(
  session({
    name: "flightinrange.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    store: MongoStore.create({
      mongoUrl: MONGODB_URL,
      collectionName: "sessions",
    }),

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

// Authentication Routes
app.use("/api/auth", authRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/collections", collectionRoutes);

// Existing public routes
app.use("/airlines", airlineRoutes);
app.use("/airlines/:slug/destinations", destinationRoutes);
app.use("/api/airlines", airlineApiRoutes);
app.use("/api/airlines/info", airlineApiRoutes);
app.use("/api/airlines/:slug", airlineApiRoutes);

// Start only after MongoDB connects.
databaseConnection
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Unable to start server:", err);
    process.exit(1);
  });
