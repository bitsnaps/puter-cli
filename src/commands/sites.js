import chalk from 'chalk';
import fetch from 'node-fetch';
import Table from 'cli-table3';
import { getCurrentUserName, getCurrentDirectory } from './auth.js';
import { API_BASE, getHeaders, generateAppName, resolvePath, isValidAppName } from '../commons.js';
import { displayNonNullValues, formatDate, formatDateTime } from '../utils.js';
import { getSubdomains, createSubdomain, deleteSubdomain } from './subdomains.js';


/**
 * Listing subdomains
 */
export async function listSites(args = {}) {
    try {
      const data = await getSubdomains(args);

      if (!data.success || !Array.isArray(data.result)) {
        throw new Error('Failed to fetch subdomains');
      }
  
      // Create table instance
      const table = new Table({
        head: [
          chalk.cyan('#'),
          chalk.cyan('UID'),
          chalk.cyan('Subdomain'),
          chalk.cyan('Created'),
          chalk.cyan('Protected'),
        //   chalk.cyan('Owner'),
          chalk.cyan('Directory')
        ],
        wordWrap: false
      });
  
      // Format and add data to table
      let i = 0;
      data.result.forEach(domain => {
        let appDir = domain?.root_dir?.path.split('/').pop().split('-');
        table.push([
          i++,
          domain.uid,
          chalk.green(`${chalk.dim(domain.subdomain)}.puter.site`),
          formatDate(domain.created_at).split(',')[0],
          domain.protected ? chalk.red('Yes') : chalk.green('No'),
        //   domain.owner['username'],
          appDir && (appDir.length == 6?`${appDir[0]}-...-${appDir.slice(-1)}`:appDir.join('-'))
        ]);
      });
  
      // Print table
      if (data.result.length === 0) {
        console.log(chalk.yellow('No subdomains found'));
      } else {
        console.log(chalk.bold('\nYour Sites:'));
        console.log(table.toString());
        console.log(chalk.dim(`Total Sites: ${data.result.length}`));
      }
  
    } catch (error) {
      console.error(chalk.red('Error listing sites:'), error.message);
      throw error;
    }
}

/**
 * Get Site info
 * @param {any[]} args Array of site uuid
 */
export async function infoSite(args = []) {
    if (args.length < 1){
        console.log(chalk.red('Usage: site <siteUID>'));
        return;
    }
    for (const subdomainId of args)
      try {
        const response = await fetch(`${API_BASE}/drivers/call`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
              interface: 'puter-subdomains',
              method: 'read',
              args: { uid: subdomainId }
          })
        });
      
        if (!response.ok) {
            throw new Error('Failed to fetch subdomains.');
        }
        const data = await response.json();
        if (!data.success || !data.result) {
          throw new Error(`Failed to get site info: ${data.error?.message}`);
        }
        displayNonNullValues(data.result);
      } catch (error) {
        console.error(chalk.red('Error getting site info:'), error.message);
      }
  }
  
  /**
  * Delete hosted web site
  * @param {any[]} args Array of site uuid
  */
  export async function deleteSite(args = []) {
    if (args.length < 1){
        console.log(chalk.red('Usage: site:delete <siteUUID>'));
        return false;
    }
    for (const uuid of args)
        try {
        // The uuid must be prefixed with: 'subdomainObj-'
        const response = await fetch(`${API_BASE}/delete-site`, {
            headers: getHeaders(),
            method: 'POST',
            body: JSON.stringify({
                site_uuid: uuid
            })
        });
    
        if (!response.ok) {
            throw new Error(`Failed to delete site (Status: ${response.status})`);
        }
    
        const data = await response.json();
        const result = await deleteSubdomain(uuid);
        if (result){
            // check if data is empty object
            if (Object.keys(data).length === 0){
                console.log(chalk.green(`Site ID: "${uuid}" should be deleted.`));
            }
        }
        console.log(chalk.yellow(`Site ID: "${uuid}" may already be deleted!`));
    } catch (error) {
        console.error(chalk.red('Error deleting site:'), error.message);
        return false;
    }
    return true;
  }
  
  /**
  * Create a static web app from the current directory to Puter cloud.
  * @param {string[]} args - Command-line arguments (e.g., [name, --subdomain=<subdomain>]).
  */
  export async function createSite(args = []) {
    if (args.length < 1 || !isValidAppName(args[0])) {
        console.log(chalk.red('Usage: site:create <valid_name_app> [<remote_dir>] [--subdomain=<subdomain>]'));
        console.log(chalk.yellow('Example: site:create mysite'));
        console.log(chalk.yellow('Example: site:create mysite ./mysite'));
        console.log(chalk.yellow('Example: site:create mysite --subdomain=mysite'));
        return;
    }
  
    const appName = args[0]; // Site name (required)
    const subdomainOption = args.find(arg => arg.toLocaleLowerCase().startsWith('--subdomain='))?.split('=')[1]; // Optional subdomain
    // Use the current directory as the root directory if none specified
    const remoteDir = resolvePath(getCurrentDirectory(), (args[1] && !args[1].startsWith('--'))?args[1]:'.');
  
    console.log(chalk.dim(`Creating site ${chalk.green(appName)} from: ${chalk.green(remoteDir)}...\n`));
    try {
        // Step 1: Determine the subdomain
        let subdomain;
        if (subdomainOption) {
            subdomain = subdomainOption; // Use the provided subdomain
        } else {
            subdomain = appName; // Default to the app name as the subdomain
        }
  
        // Step 2: Check if the subdomain already exists
        const data = await getSubdomains();
        if (!data.success || !Array.isArray(data.result)) {
          throw new Error('Failed to fetch subdomains');
        }
  
        const subdomains = data.result;
        const subdomainObj = subdomains.find(sd => sd.subdomain === subdomain);      
        if (subdomainObj) {
            console.error(chalk.cyan(`The subdomain "${subdomain}" is already in use and owned by: "${subdomainObj.owner['username']}"`));
            if (subdomainObj.owner['username'] === getCurrentUserName()){
                console.log(chalk.green(`It's yours, and linked to: ${subdomainObj.root_dir?.path}`));
                if (subdomainObj.root_dir?.path === remoteDir){
                    console.log(chalk.cyan(`Which is already the selected directory, and created at:`));
                    console.log(chalk.green(`https://${subdomain}.puter.site`));
                    return;
                } else {
                    console.log(chalk.yellow(`However, It's linked to different directory at: ${subdomainObj.root_dir?.path}`));
                    console.log(chalk.cyan(`We'll try to unlink this subdomain from that directory...`));
                    const result = await deleteSubdomain(subdomainObj?.uid);
                    if (result) {
                        console.log(chalk.green('Looks like this subdomain is free again, please try again.'));
                        return;
                    } else {
                        console.log(chalk.red('Could not release this subdomain.'));
                    }
                }
            }
        } else {
            console.log(chalk.yellow(`The subdomain: "${subdomain}" is already taken, so let's generate a new random one:`));
            subdomain = generateAppName(); // Generate a random subdomain
            console.log(chalk.cyan(`New generated subdomain: "${subdomain}" will be used.`));
        }
  
        // Step 3: Host the current directory under the subdomain
        console.log(chalk.cyan(`Hosting app "${appName}" under subdomain "${subdomain}"...`));
        const site = await createSubdomain(subdomain, remoteDir);
        if (!site){
            console.error(chalk.red(`Failed to create subdomain: "${chalk.red(subdomain)}"`));
            return;
        }
  
        console.log(chalk.green(`App ${chalk.dim(appName)} created successfully and accessible at:`));
        console.log(chalk.cyan(`https://${site.subdomain}.puter.site`));
    } catch (error) {
        console.error(chalk.red('Failed to create site.'));
        console.error(chalk.red(`Error: ${error.message}`));
    }
  }
