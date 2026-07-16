module.exports = {
  apps: [
    {
      name: 'gs-collector',
      script: 'collector.js',
      env: {
        DATABASE_URL: 'postgresql://gs_user:Gs2024VPS@localhost:5432/gs_db',
      }
    },
    {
      name: 'gs-matches-collector',
      script: 'collector-gs-matches.js',
      env: {
        DATABASE_URL: 'postgresql://gs_user:Gs2024VPS@localhost:5432/gs_db',
      }
    },
    {
      name: 'gs-bot',
      script: 'bot.js',
      env: {
        DATABASE_URL: 'postgresql://gs_user:Gs2024VPS@localhost:5432/gs_db',
      }
    },
    {
      name: 'gs-capture',
      script: 'capture-service.js',
      env: {
        DATABASE_URL: 'postgresql://gs_user:Gs2024VPS@localhost:5432/gs_db',
      }
    }
  ]
}
