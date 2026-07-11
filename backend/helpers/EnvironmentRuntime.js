/**
 * bahAI - EnvironmentRuntime
 * Detects whether the app is running in a local Desktop (Electron) environment
 * or a Cloud (Web) environment. Modifies system behaviors like file storage 
 * and process execution accordingly.
 */

const fs = require('fs');
const path = require('path');

class EnvironmentRuntime {
  constructor() {
    // Basic heuristic: check if ELECTRON_RUN_AS_NODE is set, 
    // or if a specific ENV flag forces cloud mode
    this.isElectron = !!process.env.ELECTRON_RUN_AS_NODE || !!process.versions.electron;
    this.forceCloud = process.env.FORCE_CLOUD_MODE === 'true';
  }

  get isDesktop() {
    return this.isElectron && !this.forceCloud;
  }

  get isWeb() {
    return !this.isDesktop;
  }

  /**
   * Universal file read abstraction
   */
  async readFile(filePath) {
    if (this.isDesktop) {
      // Local FS read
      return fs.promises.readFile(filePath, 'utf8');
    } else {
      // In cloud mode, files might be in S3 or DB Blob
      console.log(`[Runtime:Web] Fetching file from cloud storage: ${filePath}`);
      // return await s3Client.getObject(...)
      return "Cloud file content mock";
    }
  }

  /**
   * Universal file write abstraction
   */
  async writeFile(filePath, content) {
    if (this.isDesktop) {
      // Local FS write
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      return fs.promises.writeFile(filePath, content, 'utf8');
    } else {
      // In cloud mode, push to DB or object storage
      console.log(`[Runtime:Web] Saving file to cloud storage: ${filePath}`);
      // return await s3Client.putObject(...)
      return true;
    }
  }
}

// Export a singleton instance
module.exports = new EnvironmentRuntime();
