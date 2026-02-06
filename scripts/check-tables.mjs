import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const tables = await p.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'Telegram%'`;
console.log('Telegram tables:', tables);
await p.$disconnect();
