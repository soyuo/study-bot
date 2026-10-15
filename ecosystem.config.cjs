module.exports = {
  apps: [
    {
      name: "study-bot",
      script: "./dist/index.js",
      cwd: "/home/ubuntu/study-bot",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      env_production: { NODE_ENV: "production" },
    },
  ],
};
