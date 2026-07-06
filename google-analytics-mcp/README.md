# Google Analytics 4 (GA4) MCP Server

An MCP server designed for integration with Google Analytics 4 (GA4) properties. This server enables Claude to list available accounts/properties, query real-time traffic, run custom reports on dimensions and metrics, and fetch reporting metadata.

## Setup Instructions

To use this MCP server, you must authenticate with a Google Cloud Service Account that has permissions to read your Google Analytics 4 property.

### 1. Enable APIs in Google Cloud Console
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project.
3. Search for and enable the following two APIs:
   * **Google Analytics Data API** (for running reporting queries)
   * **Google Analytics Admin API** (for listing accounts & properties)

### 2. Create a Service Account and JSON Key
1. In the Google Cloud Console, go to **IAM & Admin > Service Accounts**.
2. Click **Create Service Account**, fill in details, and click **Create and Continue**. Skip optional steps and click **Done**.
3. Click on the newly created Service Account from the list.
4. Go to the **Keys** tab, click **Add Key > Create new key**, select **JSON**, and click **Create**.
5. Save the downloaded JSON file to this directory and name it `credentials.json`.
6. Copy the Service Account email address (e.g., `my-service-account@my-project.iam.gserviceaccount.com`).

### 3. Grant Permissions in Google Analytics
1. Log in to [Google Analytics](https://analytics.google.com/).
2. Click the **Admin** cog in the bottom left corner.
3. Select your GA4 account/property.
4. Click **Property Access Management** (or Account Access Management) in the menu.
5. Click the blue **+** button in the top right to add a user.
6. Enter the Service Account email address you copied in Step 2.
7. Assign at least the **Viewer** role.
8. Click **Add**.

### 4. Configure local Environment
1. Copy `.env.example` to `.env` in this directory:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your **GA4_PROPERTY_ID** (e.g. `123456789`). You can find this in Google Analytics > Admin > Property Settings (shown in the top right corner as a numeric ID).

---

## Development & Build

Ensure Node.js (>= 18) is installed.

```bash
# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run build

# Start the server (stdio)
npm start
```
