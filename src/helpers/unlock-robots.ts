import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

/**
 * Change general directive Disallow to Allow in robots.txt.
 */
const unlockRobots = (root: string, buildFolder: string): void => {
  const buildPath = path.resolve(root, buildFolder);
  const robotsFile = `${buildPath}/client/robots.txt`;

  if (!fs.existsSync(robotsFile)) {
    console.warn(`Failed to unlock robots.txt, file not exist: ${robotsFile}`);

    return;
  }

  const data = fs
    .readFileSync(robotsFile, { encoding: 'utf-8' })
    .replace(/Disallow: \/$/m, 'Allow: /');

  fs.writeFileSync(robotsFile, data, { encoding: 'utf-8' });

  console.info(chalk.blue('\nrobots.txt unlocked.'));
};

export default unlockRobots;
