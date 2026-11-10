const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    passwordResetTokenHash: {
      type: String,
      select: false,
    },

    passwordResetExpiresAt: {
      type: Date,
      select: false,
    },
    sessionVersion: {
      type: Number,
      default: 0,
    },
    accountWriteVersion: {
      type: Number,
      select: false,
    },
    savedDestinations: {
      type: [String],
      default: [],
    },

    savedAirlines: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

userSchema.statics.withActiveAccount = async function (
  userId,
  sessionVersion,
  write,
) {
  const sessionVersionFilter =
    sessionVersion === 0 ? { $in: [0, null] } : sessionVersion;

  let result = null;

  await this.db.transaction(async session => {
    // Reset the result in case the driver retries the transaction.
    result = null;

    const account = await this.updateOne(
      { _id: userId, sessionVersion: sessionVersionFilter },
      { $inc: { accountWriteVersion: 1 } },
      { session, timestamps: false },
    );

    if (account.matchedCount === 0) return;

    result = await write(session);
  });

  return result;
};

module.exports = mongoose.model("User", userSchema);
