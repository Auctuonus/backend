# Scripts

This folder contains isolated scripts that run in Docker containers for various maintenance and development tasks.

## Running Scripts

### Option 1: Using VSCode Tasks (Recommended)

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux), type "Run Task", and select:
- **Create Auction (Script)** - Creates a fake auction with items and users

### Option 2: Using Docker Compose

```bash
# Run a specific script
docker-compose run --rm scripts-runner ts-node scripts/create-auction.ts

# Build the scripts image
docker-compose --profile scripts build scripts-runner
```

### Option 3: Using Docker Directly

```bash
# Build the scripts image
docker build -f scripts/Dockerfile -t auctionus-scripts .

# Run a script
docker run --rm --network auctionus_auctionus-network \
  -e MONGODB_URL=mongodb://mongodb:27017/auctionus \
  auctionus-scripts ts-node scripts/create-auction.ts
```

## Available Scripts

### create-auction.ts

Creates a fake auction document with:
- 1 seller user with Telegram ID
- 1 wallet for the seller (balance: 10000)
- 3 fake items
- 1 auction with 2 rounds
  - Round 1: Starts in 5 minutes, lasts 1 hour (1 item)
  - Round 2: Starts 10 minutes after Round 1 ends, lasts 1 hour (2 items)

**Usage:**
```bash
docker-compose run --rm scripts-runner ts-node scripts/create-auction.ts
```

## Adding New Scripts

1. Create a new TypeScript file in the `scripts/` folder
2. Import models from `../src/models/`
3. Add a task in `.vscode/tasks.json` for easy execution
4. Document it in this README

Example template:

```typescript
import { connect, connection } from 'mongoose';
import { model } from 'mongoose';
import { YourSchema } from '../src/models/your.schema';

const YourModel = model('YourModel', YourSchema);

async function yourScript() {
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://mongodb:27017/auctionus';
  
  try {
    await connect(mongoUrl);
    console.log('✅ Connected to MongoDB');
    
    // Your logic here
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await connection.close();
  }
}

yourScript()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
```

## Notes

- Scripts run in an isolated container with access only to MongoDB
- The scripts container is defined with `profiles: [scripts]` so it won't start automatically with `docker-compose up`
- All scripts reuse the existing model schemas from `src/models/`
- TypeScript is compiled on-the-fly using `ts-node`
