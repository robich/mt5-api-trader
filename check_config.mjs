import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const botState = await prisma.botState.findUnique({ where: { id: 'singleton' } });
if (botState?.config) {
  const config = JSON.parse(botState.config);
  console.log(JSON.stringify(config, null, 2));
}
prisma.$disconnect();
