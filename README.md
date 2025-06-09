# World Trade Signal Processing Cron Jobs

This cron job system automatically processes influencer trading signals and updates user trading values on the blockchain based on real signal performance from the MongoDB databases.

## Overview

The system performs the following automated tasks:

1. **Fetches Influencers**: Retrieves all influencers and their subscribers from the `influencers_db` database
2. **Retrieves Signals**: Gets relevant trading signals from the `backtesting_db` based on subscription dates
3. **Processes P&L**: Calculates average P&L for each subscriber based on signals generated after their subscription
4. **Updates Blockchain**: Updates user trading values on the World Staking contract based on calculated P&L

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MongoDB       │    │   Cron Job       │    │   Blockchain    │
│                 │    │                  │    │                 │
│ influencers_db  │───▶│ Signal Processor │───▶│ World Staking   │
│ backtesting_db  │    │                  │    │ Contract        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Setup

### 1. Install Dependencies

```bash
cd cron-jobs
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure it:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017
INFLUENCERS_DB_NAME=influencers_db
BACKTESTING_DB_NAME=backtesting_db

# Blockchain Configuration
PRIVATE_KEY=your_private_key_here
RPC_URL=https://worldchain-sepolia.g.alchemy.com/v2/your-api-key

# Contract Configuration (using default contract addresses)
WORLD_STAKING_CONTRACT=0x67a16aE936BCA7e97f6B0c24001D388d6F50435F

# Cron Configuration
ENABLE_CRON=true
PROCESS_INTERVAL_MINUTES=30
RUN_IMMEDIATELY=true
```

### 3. Database Structure

Ensure your MongoDB databases have the following structure:

#### Influencers Database (`influencers_db.influencers`)
```json
{
  "_id": "...",
  "name": "holdersignals",
  "image": "https://...",
  "subscribers": [
    {
      "username": "ishamistry.3110",
      "address": "0x7c816aa1014a812b279dd46da101e1cfd536de64",
      "subscribedAt": "2025-06-05T08:43:57.599Z"
    }
  ]
}
```

#### Backtesting Database (`backtesting_db.backtesting_results_with_reasoning`)
```json
{
  "_id": "...",
  "Twitter Account": "cryptoo_doctor",
  "Signal Generation Date": "2025-04-08T11:22:44.408Z",
  "Final P&L": "17.17%",
  "backtesting_done": true,
  // ... other fields
}
```

## Usage

### Running as a Cron Job (Recommended)

Start the automated cron job scheduler:

```bash
npm run dev
```

This will:
- Run signal processing every 30 minutes (configurable)
- Automatically handle errors and retries
- Provide detailed logging
- Run continuously until stopped

### Running Once (Testing/Manual)

Process signals once and exit:

```bash
npm run process-signals
```

Or disable cron and run once:

```bash
ENABLE_CRON=false npm run dev
```

### Building for Production

```bash
npm run build
npm start
```

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `INFLUENCERS_DB_NAME` | `influencers_db` | Name of influencers database |
| `BACKTESTING_DB_NAME` | `backtesting_db` | Name of backtesting database |
| `PRIVATE_KEY` | *required* | Private key for blockchain transactions |
| `RPC_URL` | *uses default* | Blockchain RPC endpoint |
| `ENABLE_CRON` | `true` | Whether to run as recurring cron job |
| `PROCESS_INTERVAL_MINUTES` | `30` | How often to run (in minutes) |
| `RUN_IMMEDIATELY` | `false` | Run once immediately on startup |

### Cron Schedule

The cron expression is dynamically generated based on `PROCESS_INTERVAL_MINUTES`:
- `30` minutes → `*/30 * * * *` (every 30 minutes)
- `60` minutes → `*/60 * * * *` (every hour)
- `120` minutes → `*/120 * * * *` (every 2 hours)

## How It Works

### 1. Data Collection
- Fetches all influencers from `influencers_db.influencers`
- For each influencer, gets signals from `backtesting_db.backtesting_results_with_reasoning`
- Filters signals to only include those generated after subscriber subscription dates

### 2. Signal Processing
- Groups signals by subscriber wallet address
- Calculates average P&L across all relevant signals for each subscriber
- Only processes signals with valid `Final P&L` values and `backtesting_done: true`

### 3. Blockchain Updates
- For each subscriber with signals, updates their active trading stakes
- Applies the calculated average P&L to current trade values
- Uses the World Staking contract's `updateTradeValue` function
- Includes safeguards to prevent trade values from going too low

### 4. Error Handling
- Continues processing other users if one fails
- Logs detailed error information
- Maintains connection health checks
- Provides comprehensive statistics

## Monitoring and Logs

The cron job provides detailed logging including:

- Job start/end times and duration
- Number of influencers and subscribers processed
- Signal processing statistics
- Blockchain update results
- Error details and recovery attempts
- Success/failure rates over time

### Sample Log Output

```
🚀 Starting signal processing...
📡 Initializing blockchain connection...
🗄️  Connecting to MongoDB...
👥 Fetching influencers and subscribers...
Found 5 influencers with 12 total subscribers

📊 Fetching relevant signals from backtesting database...
Found 45 total signals across all influencers

⚙️  Processing signals for subscribers...
Processing cryptoo_doctor: 8 valid signals out of 10 total
Subscriber 0x7c81... (ishamistry.3110) from holdersignals: 3 relevant signals, average P&L: 12.45%

🔗 Updating blockchain trades...
Updating trades for 0x7c81...: 3 signals, average P&L: 12.45%
✅ Updated 2 trades for 0x7c81...

🎉 Signal processing completed successfully!
📈 Final Statistics:
- Influencers processed: 5
- Total subscribers: 12
- Subscribers with signals: 4
- Successful blockchain updates: 8
- Blockchain update errors: 0
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check `MONGODB_URI` is correct
   - Ensure MongoDB is running and accessible
   - Verify database names exist

2. **Blockchain Connection Failed**
   - Check `PRIVATE_KEY` is valid (without 0x prefix)
   - Verify `RPC_URL` is accessible
   - Ensure sufficient ETH for gas fees

3. **No Signals Found**
   - Verify database collections exist and have data
   - Check date filtering logic
   - Ensure `backtesting_done: true` on signals

4. **Permission Errors**
   - Ensure private key account has permission to call contract functions
   - Check if account is authorized for `updateTradeValue` function

### Debug Mode

Set environment variable for verbose logging:

```bash
DEBUG=true npm run dev
```

## Security Considerations

- Store `PRIVATE_KEY` securely (use environment variables, not hardcoded)
- Use a dedicated wallet for cron job operations
- Monitor gas usage and set appropriate limits
- Regularly backup MongoDB databases
- Use secure MongoDB connections in production

## Deployment

### Docker (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Systemd Service

```ini
[Unit]
Description=World Trade Signal Processing
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/cron-jobs
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Contributing

1. Follow clean code principles
2. Add comprehensive error handling
3. Include tests for new functionality
4. Update documentation for any changes
5. Use meaningful commit messages 