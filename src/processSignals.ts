import dotenv from 'dotenv';
import databaseManager from './utils/database.js';
import BlockchainManager from './utils/blockchain.js';
import {
  processAllInfluencerSignals,
  generateProcessingSummary
} from './utils/signalProcessor.js';

// Load environment variables
dotenv.config();

interface ProcessingStats {
  totalInfluencers: number;
  totalSubscribers: number;
  subscribersWithSignals: number;
  totalBlockchainUpdates: number;
  totalBlockchainErrors: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Main function to process signals and update blockchain trades
 */
export async function processSignalsMain(): Promise<ProcessingStats> {
  const stats: ProcessingStats = {
    totalInfluencers: 0,
    totalSubscribers: 0,
    subscribersWithSignals: 0,
    totalBlockchainUpdates: 0,
    totalBlockchainErrors: 0,
    startTime: new Date()
  };

  let blockchainManager: BlockchainManager | null = null;

  try {
    console.log('🚀 Starting signal processing...');
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

    // Debug database state before processing
    await databaseManager.debugDatabaseState();

    // Step 1: Retrieve all influencers and their subscribers
    console.log('👥 Fetching influencers and subscribers...');
    const influencers = await databaseManager.getAllInfluencers();
    stats.totalInfluencers = influencers.length;
    
    // Calculate total subscribers
    stats.totalSubscribers = influencers.reduce(
      (total, influencer) => {
        const subscriberCount = influencer.subscribers && Array.isArray(influencer.subscribers) 
          ? influencer.subscribers.length 
          : 0;
        return total + subscriberCount;
      },
      0
    );

    console.log(`Found ${stats.totalInfluencers} influencers with ${stats.totalSubscribers} total subscribers`);

    if (stats.totalInfluencers === 0) {
      console.log('No influencers found in database');
      return stats;
    }

    // Step 2: Get relevant signals for all influencers
    console.log('Fetching relevant signals from backtesting database...');
    const signalsMap = await databaseManager.getRelevantSignals(influencers);
    
    const totalSignalsFound = Array.from(signalsMap.values()).reduce(
      (total, signals) => total + signals.length,
      0
    );
    console.log(`Found ${totalSignalsFound} total signals across all influencers.`);

    // Step 3: Process signals for each subscriber (within 7-day windows)
    console.log('Processing signals for subscribers (within 7-day windows from subscription)...');
    const subscriberResults = await processAllInfluencerSignals(influencers, signalsMap);
    stats.subscribersWithSignals = subscriberResults.size;

    // Generate and display processing summary
    const summary = generateProcessingSummary(subscriberResults);
    console.log(summary);

    if (stats.subscribersWithSignals === 0) {
      console.log('No subscribers with new signals found');
      return stats;
    }

    // Step 4: Update blockchain trades based on processed signals
    console.log('Updating blockchain trades...');
    
    for (const [subscriberAddress, result] of subscriberResults) {
      try {
        console.log(
          `Updating trades for ${subscriberAddress}: ` +
          `${result.newSignalsCount} new signals processed, total cumulative P&L: ${result.totalSumPnL}`
        );

        const updateResult = await blockchainManager.updateUserTradesWithSignals(
          subscriberAddress as `0x${string}`,
          result.totalSumPnL
        );

        stats.totalBlockchainUpdates += updateResult.updated;
        stats.totalBlockchainErrors += updateResult.errors;

        console.log(
          `Updated ${updateResult.updated} trades for ${subscriberAddress}` +
          (updateResult.errors > 0 ? ` (${updateResult.errors} errors)` : '')
        );

        // Debug the user signal summary after processing
        await databaseManager.debugUserSignalSummary(subscriberAddress);

        // Add delay between users to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error updating trades for ${subscriberAddress}:`, error);
        stats.totalBlockchainErrors++;
      }
    }

    stats.endTime = new Date();
    const duration = stats.endTime.getTime() - stats.startTime.getTime();

    console.log('\nSignal processing completed successfully!');
    console.log(`End time: ${stats.endTime.toISOString()}`);
    console.log(`Total duration: ${Math.round(duration / 1000)} seconds`);
    console.log('\n📈 Final Statistics:');
    console.log(`- Influencers processed: ${stats.totalInfluencers}`);
    console.log(`- Total subscribers: ${stats.totalSubscribers}`);
    console.log(`- Subscribers with signals: ${stats.subscribersWithSignals}`);
    console.log(`- Successful blockchain updates: ${stats.totalBlockchainUpdates}`);
    console.log(`- Blockchain update errors: ${stats.totalBlockchainErrors}`);

    return stats;

  } catch (error) {
    console.error('Fatal error during signal processing:', error);
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