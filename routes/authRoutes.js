// Dependencies and database models
const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Collection = require("../models/Collections");
const { createHash, randomBytes } = require("node:crypto");

const router = express.Router();

// Request safeguards

// Routes using authLimiter share a limit of 10 requests per 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many attempts. Please try again later.",
  },
});

// Require the configured frontend origin for auth requests that change state.
function verifyOrigin(req, res, next) {
  const origin = req.get("Origin");

  if (!origin || origin !== process.env.CLIENT_URL) {
    return res.status(403).json({
      message: "Request origin not allowed.",
    });
  }

  next();
}

// The current-user lookup is read-only. All other methods go through the check.
router.use((req, res, next) => {
  if (req.method === "GET") {
    return next();
  }

  return verifyOrigin(req, res, next);
});

// Registration and sign-in

// REGISTER — validate the input and create a new account.
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check the types before trimming or measuring any of the values.
    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Username, email, and password are required.",
      });
    }

    // Normalize the account identifiers before validation and lookup.
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (
      cleanUsername.length < 3 ||
      cleanUsername.length > 30 ||
      !/^[a-zA-Z0-9_]+$/.test(cleanUsername)
    ) {
      return res.status(400).json({
        message: "Username must be 3–30 letters, numbers, or underscores.",
      });
    }

    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        message: "Enter a valid email address.",
      });
    }

    // Measure the upper limit in UTF-8 bytes for bcrypt.
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        message:
          "Password must be at least 12 characters and no more than 72 bytes.",
      });
    }

    // Check whether either account identifier is already taken.
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Username or email already in use.",
      });
    }

    // Store the password hash and return only the account fields the UI needs.
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
    });

    return res.status(201).json({
      message: "Account created successfully.",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    // The unique index can catch a duplicate created after the lookup above.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Username or email already in use.",
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Unable to create account.",
    });
  }
});

// LOGIN — verify credentials and save a new authenticated session.
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    // The User model hides passwordHash by default, so select it for this lookup.
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+passwordHash");

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    // Start with a fresh session ID after the credentials are verified.
    req.session.regenerate(error => {
      if (error) {
        console.error("Session error:", error);

        return res.status(500).json({
          message: "Unable to log in.",
        });
      }

      req.session.userId = user.id;

      // Save the version that app.js will compare on later requests.
      // Accounts created before this field was added start at version 0.
      req.session.sessionVersion = user.sessionVersion ?? 0;

      // Wait for the session store before reporting a successful login.
      req.session.save(error => {
        if (error) {
          console.error("Session save error:", error);

          return res.status(500).json({
            message: "Unable to save login session.",
          });
        }

        return res.json({
          message: "Login successful.",
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
          },
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Unable to log in.",
    });
  }
});

// Session lookup and sign-out

// CURRENT USER — let the frontend restore the signed-in user after a refresh.
router.get("/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        message: "Not authenticated.",
      });
    }

    // Look up the session owner and return only the profile fields the app needs.
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Session check error:", error);

    return res.status(500).json({
      message: "Unable to check session.",
    });
  }
});

// LOGOUT — remove the stored session, then clear the browser cookie.
router.post("/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        message: "Unable to log out.",
      });
    }

    res.clearCookie("flightinrange.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    return res.json({
      message: "Logged out successfully.",
    });
  });
});

// Password recovery

// FORGOT PASSWORD — create a reset link and email it to the account holder.
router.post("/forgot-password", authLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  const cleanEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";

  if (
    cleanEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  const { CLIENT_URL, RESEND_API_KEY, PASSWORD_RESET_FROM } = process.env;

  if (!CLIENT_URL || !RESEND_API_KEY || !PASSWORD_RESET_FROM) {
    return res.status(503).json({
      message: "Password recovery is temporarily unavailable.",
    });
  }

  // Respond before looking up the account or contacting the email provider.
  res.status(202).json({
    message: "If an account exists for that email, we'll send a reset link.",
  });

  try {
    const token = randomBytes(32).toString("hex");
    const resetUrl = new URL("/reset-password", CLIENT_URL);
    resetUrl.hash = `token=${token}`;

    // Store the hash and replace any previous reset token for this account.
    const user = await User.findOneAndUpdate(
      { email: cleanEmail },
      {
        $set: {
          passwordResetTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
          passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      },
    )
      .select("email")
      .lean();

    if (!user) return;

    // Send the link to the address stored on the account.
    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: PASSWORD_RESET_FROM,
        to: [user.email],
        subject: "Reset your FlightInRange password",
        text: [
          "Open this link to reset your FlightInRange password:",
          resetUrl.toString(),
          "",
          "The link expires in 30 minutes. If you didn't request a reset, you can ignore this email.",
        ].join("\n"),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!delivery.ok) {
      console.error("Password reset email rejected:", delivery.status);
    }
  } catch (error) {
    console.error("Password reset request failed:", error.name);
  }
});

// RESET PASSWORD — verify the token, update the password, and revoke old sessions.
router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    const invalidTokenMessage = "This reset link is invalid or has expired.";

    // The email endpoint will issue a 32-byte token encoded as 64 hex characters.
    if (
      typeof token !== "string" ||
      token.length !== 64 ||
      !/^[a-f0-9]+$/.test(token)
    ) {
      return res.status(400).json({ message: invalidTokenMessage });
    }

    // Apply the same password rules as registration.
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message:
          "Password must be at least 12 characters and no more than 72 bytes.",
      });
    }

    // Look up the token by its hash before doing the bcrypt work.
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    })
      .select("_id")
      .lean();

    if (!user) {
      return res.status(400).json({ message: invalidTokenMessage });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Recheck the token at write time so only one request can use it.
    // Change the password, consume the token, and revoke sessions in one update.
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: new Date() },
      },
      {
        $set: { passwordHash },
        $unset: {
          passwordResetTokenHash: "",
          passwordResetExpiresAt: "",
        },
        $inc: { sessionVersion: 1 },
      },
    )
      .select("_id")
      .lean();

    if (!updatedUser) {
      return res.status(400).json({ message: invalidTokenMessage });
    }

    return res.json({
      message: "Password updated. Sign in with your new password.",
    });
  } catch (error) {
    console.error("Password reset failed:", error.name);

    return res.status(500).json({
      message: "Unable to reset your password. Please try again later.",
    });
  }
});

// Account deletion

// DELETE ACCOUNT — verify the current password and remove the account’s data.
router.delete("/account", authLimiter, async (req, res) => {
  // The signed-in session identifies the account to delete.
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Please log in first." });
  }

  const { password } = req.body ?? {};

  if (typeof password !== "string" || !password) {
    return res.status(400).json({ message: "Enter your current password." });
  }

  try {
    // Include the normally hidden password hash for the bcrypt check.
    const user = await User.findById(userId).select("+passwordHash");

    if (!user) {
      return res.status(401).json({ message: "Please log in first." });
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(403).json({
        message: "Your current password is incorrect.",
      });
    }

    // Coordinate deletion with trip and collection creation in one transaction.
    const deleted = await User.withActiveAccount(
      userId,
      req.session.sessionVersion ?? 0,
      async session => {
        // Recheck the verified hash and remove the account and its saved favorites.
        const account = await User.deleteOne(
          { _id: userId, passwordHash: user.passwordHash },
          { session },
        );

        if (account.deletedCount !== 1) return false;

        // Remove only records owned by this account.
        await Trip.deleteMany({ user: userId }, { session });
        await Collection.deleteMany({ user: userId }, { session });

        return true;
      },
    );

    if (!deleted) {
      return res.status(409).json({
        message: "Your account or session changed. Sign in again and retry.",
      });
    }
  } catch (error) {
    console.error("Account deletion failed:", error.name);

    return res.status(500).json({
      message: "Unable to delete your account.",
    });
  }

  // The deletion has committed. Destroy this session and clear its cookie.
  req.session.destroy(error => {
    if (error) {
      console.error("Deleted account session cleanup failed:", error.name);
    }

    res.clearCookie("flightinrange.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    return res.json({ message: "Your account has been deleted." });
  });
});

// Export the router mounted at /api/auth in app.js.
module.exports = router;
