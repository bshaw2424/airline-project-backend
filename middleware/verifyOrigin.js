const verifyOrigin = (req, res, next) => {
  const origin = req.get("Origin");

  if (!origin || origin !== process.env.CLIENT_URL) {
    return res.status(403).json({
      message: "Request origin not allowed.",
    });
  }

  next();
};

module.exports = verifyOrigin;
