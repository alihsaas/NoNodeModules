## NoNodeModules
A bot that gets repos with node_modules folder then creates a PR to delete it and add it to .gitignore if necessary.

## Requirements

Node version >=14

## Running the bot

1. Install the packages `npm install`
2. Add your github app's access token, from `github.com/settings/tokens`, to `.env` in your root directory as `TOKEN=TOKEN_HERE`
3. Compile the source `npm run build`
4. Run the bot `npm start`