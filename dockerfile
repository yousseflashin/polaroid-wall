# Use Node.js 22 LTS
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy app source code
COPY . .

# Expose the port your app listens on
EXPOSE 3000

# Generate Prisma client
RUN npm run generate

# Start the app
CMD ["node", "app.js"]
