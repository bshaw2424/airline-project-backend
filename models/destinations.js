const { Schema, model } = require("mongoose");

const destinationSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  location: {
    type: String,
    required: true,
    unique: true,
  },
  international: {
    type: String,
    enum: ["false", "true"],
    default: "false",
    unique: true,
    required: true,
  },
  seasonal: {
    type: String,
    enum: ["false", "true"],
    default: "false",
    unique: true,
    required: ture,
  },
  aiport: {
    name: {
      type: String,
      unique: true,
      required: true,
    },
    code: {
      type: String,
      unique: true,
      upercase: true,
      maxLength: 3,
      required: true,
    },
  },
  destinations: [{ type: Schema.Types.ObjectId, ref: "Airline" }],
});

destinationSchema.pre("save", function (next) {
  this.slug = slugify(this.title, {
    lower: true,
  });
  next();
});

module.exports = model("Destination", destinationSchema);
