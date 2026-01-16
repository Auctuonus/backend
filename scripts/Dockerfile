FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy scripts and models
COPY scripts/ ./scripts/
COPY src/ ./src/

# Install ts-node globally for script execution
RUN npm install -g ts-node typescript

# Default command (can be overridden)
CMD ["echo", "Scripts container ready. Run with docker-compose run scripts-runner <script-name>"]
