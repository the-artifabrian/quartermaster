# 👨‍🍳 Quartermaster

Your personal recipe manager. Organize your recipes, track your ingredients, and discover what you can make with what you have.

## Features

- **Recipe Management**: Store and organize 100+ recipes with ingredients, instructions, prep/cook times, and tags
- **Smart Search**: Full-text search across recipe titles, ingredients, and descriptions
- **Kitchen Inventory**: Track what's in your pantry, fridge, and freezer
- **Recipe Discovery**: Find recipes based on ingredients you already have
- **Match Percentage**: See how many ingredients you have for each recipe
- **Mobile-First Design**: Beautiful, responsive interface with bottom navigation for easy mobile use
- **Image Support**: Add photos to your recipes (or enjoy colorful gradient placeholders)
- **Tag System**: Organize by cuisine, meal type, and dietary preferences

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npm run setup

# Start development server
npm run dev
```

Visit http://localhost:3000 and create an account to get started!

## Sample Data

New users automatically receive:
- 18 sample recipes to explore
- 38 sample inventory items (pantry, fridge, freezer)

This helps you get familiar with the app right away!

## Tech Stack

- **Framework**: React Router v7 (Remix)
- **Database**: SQLite with Prisma ORM
- **Styling**: Tailwind CSS with shadcn/ui components
- **Auth**: Session-based authentication with email verification
- **Deployment**: Designed for Fly.io or self-hosting

## Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run typecheck    # Run TypeScript checks
npm run lint         # Run ESLint
npm run reseed       # Clear and re-seed sample data
npx prisma studio    # Open database GUI
```

## Development Roadmap

- ✅ **Phase 1**: Recipe CRUD with search and tags
- ✅ **Phase 2**: Inventory tracking and recipe matching
- 🚧 **Phase 3**: Meal planning and shopping lists
- 📋 **Phase 4**: Cooking mode and smart suggestions

## Documentation

See the [Development Plan](docs/DEVELOPMENT_PLAN.md) for detailed project information.

## Built With

This project was bootstrapped from the [Epic Stack](https://www.epicweb.dev/epic-stack) by Kent C. Dodds.

## License

MIT
