import cron from 'node-cron';
import dotenv from 'dotenv';
import { processSignalsMain } from './processSignals.js';

// Load environment variables
dotenv.config();

interface CronJobStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunTime?: Date;
  lastSuccessTime?: Date;
  lastErrorTime?: Date;
  lastError?: string;
}

class CronJobManager {
  private stats: CronJobStats = {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0
  };

  private cronJob?: cron.ScheduledTask;
  private readonly cronExpression: string;

  constructor() {
    // Default to every 30 minutes, but allow configuration via environment
    const intervalMinutes = parseInt(process.env.PROCESS_INTERVAL_MINUTES || '30');
    this.cronExpression = `*/${intervalMinutes} * * * *`;
    
    console.log(`🕐 Cron job configured to run every ${intervalMinutes} minutes`);
    console.log(`📅 Cron expression: ${this.cronExpression}`);
  }

  /**
   * Starts the cron job
   */
  start(): void {
    if (this.cronJob) {
      console.log('⚠️  Cron job is already running');
      return;
    }

    console.log('🚀 Starting cron job scheduler...');
    
    this.cronJob = cron.schedule(this.cronExpression, async () => {
      await this.executeJob();
    }, {
      scheduled: false, // Don't start immediately
      timezone: 'UTC'
    });

    this.cronJob.start();
    console.log('✅ Cron job scheduler started successfully');
    
    // Run once immediately if enabled
    if (process.env.RUN_IMMEDIATELY === 'true') {
      console.log('🏃 Running job immediately...');
      setTimeout(() => this.executeJob(), 1000);
    }
  }

  /**
   * Stops the cron job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
      console.log('🛑 Cron job scheduler stopped');
    }
  }

  /**
   * Executes the signal processing job
   */
  private async executeJob(): Promise<void> {
    const jobStartTime = new Date();
    this.stats.totalRuns++;
    this.stats.lastRunTime = jobStartTime;

    console.log('\n' + '='.repeat(80));
    console.log(`🔄 Starting scheduled job #${this.stats.totalRuns}`);
    console.log(`⏰ Start time: ${jobStartTime.toISOString()}`);
    console.log('='.repeat(80));

    try {
      // Execute the main signal processing function
      const processingStats = await processSignalsMain();
      
      this.stats.successfulRuns++;
      this.stats.lastSuccessTime = new Date();
      
      const jobEndTime = new Date();
      const duration = jobEndTime.getTime() - jobStartTime.getTime();
      
      console.log('\n' + '='.repeat(80));
      console.log(`✅ Job #${this.stats.totalRuns} completed successfully`);
      console.log(`⏱️  Duration: ${Math.round(duration / 1000)} seconds`);
      console.log(`📊 Processed: ${processingStats.subscribersWithSignals} subscribers with signals`);
      console.log(`🔗 Blockchain updates: ${processingStats.totalBlockchainUpdates}`);
      console.log('='.repeat(80));

    } catch (error) {
      this.stats.failedRuns++;
      this.stats.lastErrorTime = new Date();
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      
      const jobEndTime = new Date();
      const duration = jobEndTime.getTime() - jobStartTime.getTime();
      
      console.error('\n' + '='.repeat(80));
      console.error(`❌ Job #${this.stats.totalRuns} failed`);
      console.error(`⏱️  Duration: ${Math.round(duration / 1000)} seconds`);
      console.error(`💥 Error: ${this.stats.lastError}`);
      console.error('='.repeat(80));
    }

    // Log current statistics
    this.logStats();
  }

  /**
   * Logs current job statistics
   */
  private logStats(): void {
    const successRate = this.stats.totalRuns > 0 
      ? ((this.stats.successfulRuns / this.stats.totalRuns) * 100).toFixed(1)
      : '0.0';

    console.log('\n📈 Current Statistics:');
    console.log(`- Total runs: ${this.stats.totalRuns}`);
    console.log(`- Successful runs: ${this.stats.successfulRuns}`);
    console.log(`- Failed runs: ${this.stats.failedRuns}`);
    console.log(`- Success rate: ${successRate}%`);
    
    if (this.stats.lastSuccessTime) {
      console.log(`- Last success: ${this.stats.lastSuccessTime.toISOString()}`);
    }
    
    if (this.stats.lastErrorTime) {
      console.log(`- Last error: ${this.stats.lastErrorTime.toISOString()}`);
    }
  }

  /**
   * Returns current statistics
   */
  getStats(): CronJobStats {
    return { ...this.stats };
  }
}

/**
 * Main function to initialize and start the cron job manager
 */
async function main() {
  console.log('🌟 World Trade Signal Processing Cron Job');
  console.log('==========================================');
  
  // Check if cron jobs are enabled
  const cronEnabled = process.env.ENABLE_CRON !== 'false';
  
  if (!cronEnabled) {
    console.log('⚠️  Cron jobs are disabled via ENABLE_CRON environment variable');
    console.log('🏃 Running signal processing once and exiting...');
    
    try {
      await processSignalsMain();
      console.log('✅ Single run completed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Single run failed:', error);
      process.exit(1);
    }
    return;
  }

  // Validate required environment variables
  const requiredEnvVars = ['PRIVATE_KEY', 'MONGODB_URI'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  // Create and start the cron job manager
  const cronManager = new CronJobManager();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    cronManager.stop();
    console.log('👋 Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    cronManager.stop();
    console.log('👋 Goodbye!');
    process.exit(0);
  });

  // Start the cron job
  cronManager.start();
  
  console.log('🎯 Cron job is now running...');
  console.log('📝 Press Ctrl+C to stop');
}

// Start the application
main().catch((error) => {
  console.error('💥 Failed to start cron job manager:', error);
  process.exit(1);
}); 