import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config();

const defaultApiBaseUrl = 'https://oryfg9nq1e.execute-api.eu-north-1.amazonaws.com';
const apiBaseUrl = process.env.API_BASE_URL || defaultApiBaseUrl;

const environmentsDir = path.join(process.cwd(), 'src', 'environments');
fs.mkdirSync(environmentsDir, { recursive: true });

const developmentEnvironment = `export const environment = {\n  production: false,\n  apiBaseUrl: '${apiBaseUrl}'\n};\n`;

const productionEnvironment = `export const environment = {\n  production: true,\n  apiBaseUrl: '${apiBaseUrl}'\n};\n`;

fs.writeFileSync(path.join(environmentsDir, 'environment.ts'), developmentEnvironment, 'utf8');
fs.writeFileSync(path.join(environmentsDir, 'environment.prod.ts'), productionEnvironment, 'utf8');

console.log(`Environment files generated with API_BASE_URL=${apiBaseUrl}`);
