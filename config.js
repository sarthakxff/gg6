module.exports = {
  maxAccounts: 10,
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10),
};
