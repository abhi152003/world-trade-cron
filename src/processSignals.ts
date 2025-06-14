import dotenv from 'dotenv';
import databaseManager from './utils/database.js';
import BlockchainManager from './utils/blockchain.js';
import {
  processStakeExits,
  generateStakeExitSummary
} from './utils/stakeExitProcessor.js';

// Load environment variables
dotenv.config();

interface ProcessingStats {
  totalUsersWithStakes: number;
  totalStakes: number;
  stakesReadyToExit: number;
  totalBlockchainExits: number;
  totalBlockchainErrors: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Main function to process stake exits based on exitTimestamp
 */
export async function processSignalsMain(): Promise<ProcessingStats> {
  const stats: ProcessingStats = {
    totalUsersWithStakes: 0,
    totalStakes: 0,
    stakesReadyToExit: 0,
    totalBlockchainExits: 0,
    totalBlockchainErrors: 0,
    startTime: new Date()
  };

  let blockchainManager: BlockchainManager | null = null;

  try {
    console.log('🚀 Starting stake exit processing...');
    console.log(`Start time: ${stats.startTime.toISOString()}`);

    // Validate required environment variables
    const requiredEnvVars = ['PRIVATE_KEY', 'MONGODB_URI'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    // Initialize blockchain manager
    console.log('📡 Initializing blockchain connection...');
    blockchainManager = new BlockchainManager(process.env.PRIVATE_KEY!);
    
    // Health check for blockchain
    const blockchainHealthy = await blockchainManager.healthCheck();
    if (!blockchainHealthy) {
      throw new Error('Blockchain health check failed');
    }

    // Connect to MongoDB
    console.log('🗄️  Connecting to MongoDB...');
    await databaseManager.connect();
    
    // Health check for database
    const databaseHealthy = await databaseManager.healthCheck();
    if (!databaseHealthy) {
      throw new Error('Database health check failed');
    }

    // Step 1: Get all user stakes from world-staking database
    console.log('💰 Fetching user stakes from world-staking database...');
    const allUserStakes = await databaseManager.getAllUserStakes();
    stats.totalUsersWithStakes = allUserStakes.length;
    
    // Calculate total stakes
    stats.totalStakes = allUserStakes.reduce(
      (total, userStakes) => total + userStakes.stakes.length,
      0
    );

    console.log(`Found ${stats.totalUsersWithStakes} users with ${stats.totalStakes} total stakes`);

    if (stats.totalUsersWithStakes === 0) {
      console.log('No user stakes found in database');
      return stats;
    }

    // Step 2: Get stakes that have passed their exit timestamp
    console.log('⏰ Checking for stakes ready to exit...');
    const stakesReadyToExit = await databaseManager.getStakesReadyToExit();
    
    stats.stakesReadyToExit = stakesReadyToExit.reduce(
      (total, userStakeData) => total + userStakeData.readyStakes.length,
      0
    );

    console.log(`Found ${stats.stakesReadyToExit} stakes ready to exit across ${stakesReadyToExit.length} users`);

    if (stats.stakesReadyToExit === 0) {
      console.log('No stakes are ready to exit at this time');
      return stats;
    }

    // Step 3: Get relevant signals for stake time ranges
    console.log('📊 Fetching signals for stake time ranges...');
    const signalsMap = await databaseManager.getSignalsForStakeRanges(stakesReadyToExit);
    
    const totalSignalsFound = Array.from(signalsMap.values()).reduce(
      (total, signals) => total + signals.length,
      0
    );
    console.log(`Found ${totalSignalsFound} total signals across all influencers.`);

    // Step 4: Process stake exits and calculate final trade values
    console.log('🔄 Processing stake exits and calculating final trade values...');
    const stakeExitResults = await processStakeExits(stakesReadyToExit, signalsMap);

    // Generate and display processing summary
    const summary = generateStakeExitSummary(stakeExitResults);
    console.log(summary);

    if (stakeExitResults.length === 0) {
      console.log('No stake exits to process');
      return stats;
    }

    // Step 5: Exit trades on blockchain
    console.log('🏁 Exiting trades on blockchain...');
    
    for (const stakeExitData of stakeExitResults) {
      try {
        console.log(
          `Exiting trade for ${stakeExitData.walletAddress}[${stakeExitData.stakeIndex}]: ` +
          `${stakeExitData.signals.length} signals processed, total P&L: ${stakeExitData.totalPnL}, ` +
          `final trade value: ${stakeExitData.finalTradeValue}`
        );

        // Convert final trade value string to BigInt (already in wei)
        const finalTradeValueWei = BigInt(stakeExitData.finalTradeValue);

        const exitResult = await blockchainManager.exitTrade(
          stakeExitData.walletAddress as `0x${string}`,
          stakeExitData.stakeIndex,
          finalTradeValueWei
        );

        if (exitResult) {
          stats.totalBlockchainExits++;
          console.log(`Successfully exited trade for ${stakeExitData.walletAddress}[${stakeExitData.stakeIndex}]`);
        } else {
          stats.totalBlockchainErrors++;
          console.error(`Failed to exit trade for ${stakeExitData.walletAddress}[${stakeExitData.stakeIndex}]`);
        }

        // Add delay between exits to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error exiting trade for ${stakeExitData.walletAddress}[${stakeExitData.stakeIndex}]:`, error);
        stats.totalBlockchainErrors++;
      }
    }

    stats.endTime = new Date();
    const duration = stats.endTime.getTime() - stats.startTime.getTime();

    console.log('\nStake exit processing completed successfully!');
    console.log(`End time: ${stats.endTime.toISOString()}`);
    console.log(`Total duration: ${Math.round(duration / 1000)} seconds`);
    console.log('\n📈 Final Statistics:');
    console.log(`- Users with stakes: ${stats.totalUsersWithStakes}`);
    console.log(`- Total stakes: ${stats.totalStakes}`);
    console.log(`- Stakes ready to exit: ${stats.stakesReadyToExit}`);
    console.log(`- Successful blockchain exits: ${stats.totalBlockchainExits}`);
    console.log(`- Blockchain exit errors: ${stats.totalBlockchainErrors}`);

    return stats;

  } catch (error) {
    console.error('Fatal error during stake exit processing:', error);
    stats.endTime = new Date();
    throw error;
  } finally {
    // Cleanup connections
    try {
      await databaseManager.disconnect();
      console.log('Disconnected from MongoDB');
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error);
    }
  }
}

/**
 * Run the script directly if called from command line
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  processSignalsMain()
    .then((stats) => {
      console.log('\n Process completed with stats:', stats);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n Process failed:', error);
      process.exit(1);
    });
} 