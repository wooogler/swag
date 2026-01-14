#!/bin/bash

# SWAG Deployment Script
# Usage: ./deploy.sh [domain]

set -e

# Configuration
CONTAINER_NAME="swag"
IMAGE_NAME="swag:latest"
DOMAIN="${1:-swag.example.com}"
CONTAINER_PORT="3000"
HOST_PORT="127.0.0.1:3000"

# Database configuration
DB_NAME="swag"
DB_USER="swag"
DB_PASSWORD="swag"
DB_HOST="127.0.0.1"
DB_PORT="5432"

echo "🚀 Starting deployment for $DOMAIN..."

# Step 1: Check if PostgreSQL is installed
echo "📊 Checking PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install it first:"
    echo "   sudo dnf install -y postgresql-server postgresql-contrib"
    exit 1
fi

# Step 2: Initialize PostgreSQL if needed
# Check if PostgreSQL is already initialized by checking if postgresql is active or data directory has content
if systemctl is-active --quiet postgresql || [ -f "/var/lib/pgsql/data/postgresql.conf" ]; then
    echo "✅ PostgreSQL already initialized, skipping setup..."
else
    echo "🔧 Initializing PostgreSQL database..."
    sudo postgresql-setup --initdb

    # Configure PostgreSQL to use md5 authentication for local connections
    echo "🔐 Configuring PostgreSQL authentication..."
    sudo sed -i 's/^local.*all.*all.*peer$/local   all             all                                     md5/' /var/lib/pgsql/data/pg_hba.conf
    sudo sed -i 's/^local.*all.*all.*ident$/local   all             all                                     md5/' /var/lib/pgsql/data/pg_hba.conf
    sudo sed -i 's/^host.*all.*all.*127\.0\.0\.1\/32.*ident$/host    all             all             127.0.0.1\/32            md5/' /var/lib/pgsql/data/pg_hba.conf
    sudo sed -i 's/^host.*all.*all.*127\.0\.0\.1\/32.*peer$/host    all             all             127.0.0.1\/32            md5/' /var/lib/pgsql/data/pg_hba.conf
fi

# Step 3: Check if PostgreSQL is running
if ! systemctl is-active --quiet postgresql; then
    echo "⚠️  PostgreSQL is not running. Starting..."
    sudo systemctl start postgresql
    sudo systemctl enable postgresql

    # Wait a moment for PostgreSQL to fully start
    sleep 3
fi

# Step 3: Create database and user (if not exists)
echo "🗄️  Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>/dev/null | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "Database might already exist"

sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" 2>/dev/null | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || echo "User might already exist"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null || true

echo "✅ Database setup complete"

# Step 4: Check .env file
echo "📝 Checking .env file..."
if [ ! -f .env ]; then
    echo "❌ .env file not found. Creating from example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "⚠️  Please edit .env file with your configuration and run the script again."
        exit 1
    else
        echo "❌ .env.example not found. Please create .env file manually."
        exit 1
    fi
fi

# Update database URL in .env if needed
if ! grep -q "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" .env 2>/dev/null; then
    echo "🔧 Updating DATABASE_URL in .env..."
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME|" .env
    sed -i "s|^POSTGRES_URL=.*|POSTGRES_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME|" .env
fi

echo "✅ .env file ready"

# Step 5: Run database migrations
echo "🔄 Running database migrations..."
set -a
source .env
set +a
npm run db:push || npm run db:migrate || true

# Step 6: Stop and remove existing container
echo "🛑 Stopping existing container..."
podman stop $CONTAINER_NAME 2>/dev/null || true
podman rm -f $CONTAINER_NAME 2>/dev/null || true
# Also try to clean up any root-owned containers with the same name
sudo podman stop $CONTAINER_NAME 2>/dev/null || true
sudo podman rm -f $CONTAINER_NAME 2>/dev/null || true

# Step 7: Build Docker image
echo "🔨 Building Docker image..."
podman build -t $IMAGE_NAME .

# Step 8: Create systemd service for auto-restart (using root podman)
echo "🔧 Setting up systemd service..."
ABSOLUTE_PATH=$(realpath $PWD)
sudo tee /etc/systemd/system/swag.service > /dev/null << EOF
[Unit]
Description=SWAG Application Container
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ABSOLUTE_PATH
ExecStartPre=-/usr/bin/podman stop $CONTAINER_NAME
ExecStartPre=-/usr/bin/podman rm -f $CONTAINER_NAME
ExecStart=/usr/bin/podman run --rm --name $CONTAINER_NAME --network=host --env-file $ABSOLUTE_PATH/.env $IMAGE_NAME
ExecStop=/usr/bin/podman stop -t 10 $CONTAINER_NAME
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Copy image to root podman
echo "📦 Copying image to root podman..."
podman save $IMAGE_NAME | sudo podman load

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable swag.service
sudo systemctl restart swag.service

# Step 9: Wait for container to be healthy
echo "⏳ Waiting for container to be healthy..."
sleep 5

if systemctl is-active --quiet swag.service; then
    echo "✅ Service is running"
else
    echo "❌ Service failed to start. Checking logs..."
    sudo journalctl -u swag.service -n 50 --no-pager
    exit 1
fi

# Step 10: Configure Nginx
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/conf.d/$DOMAIN.conf > /dev/null << 'NGINX_EOF'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name DOMAIN_PLACEHOLDER;

    # SSL configuration (will be managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy settings
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Client max body size (for uploads)
    client_max_body_size 10M;
}
NGINX_EOF

# Replace domain placeholder
sudo sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/conf.d/$DOMAIN.conf

# Test Nginx configuration
echo "🔍 Testing Nginx configuration..."
sudo nginx -t

# Reload Nginx
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo ""
echo "📋 Next steps:"
echo "1. Make sure DNS is pointing to this server"
echo "2. Run Certbot to get SSL certificate:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo ""
echo "✅ Deployment complete!"
echo "🌐 App will be available at: https://$DOMAIN (after SSL setup)"
echo ""
echo "📊 Useful commands:"
echo "   sudo systemctl status swag        # Check service status"
echo "   sudo systemctl restart swag       # Restart service"
echo "   sudo journalctl -u swag -f        # View logs (follow mode)"
echo "   podman logs $CONTAINER_NAME       # View container logs"
