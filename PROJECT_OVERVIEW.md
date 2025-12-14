# ChildTale - Project Overview & Architecture

## What is ChildTale?

ChildTale is an AI-powered web application that creates **personalized coloring books** for children. Parents input details about their child and a story idea, and the app instantly generates a custom storybook where that specific child is the main character, with black-and-white illustrations designed for coloring.

---

## Core Features

### 1. Personalized Story Generation
- Parents describe their child (name, age, appearance, personality)
- Choose a category: Magical Dream, Adventure, Milestone, or Memory
- Provide a story prompt or plot idea
- AI generates a complete story with the child as the hero

### 2. Custom Coloring Book Illustrations
- Each page includes black-and-white line art
- Illustrations feature the child's specific characteristics
- Consistent character design throughout the story
- Disney/Pixar-inspired style with thick, clear outlines

### 3. Interactive Digital Coloring
- Built-in "Magic Studio" coloring interface
- Flood-fill bucket tool for easy digital coloring
- Works on tablets and computers
- Kids can color their personalized story digitally

### 4. Physical & Digital Products
- **Free Sample**: 5-page story preview (1 per user)
- **Digital Story**: 25-page PDF without watermarks
- **Hardcover Book**: Physical 8x8" printed book (shipped)

---

## User Workflow

```
1. Customization
   ↓
   User fills form:
   - Child's name, age, gender
   - Physical description (hair, eyes, features)
   - Story category & plot idea
   
2. AI Generation
   ↓
   - Gemini generates story structure (JSON)
   - Gemini creates coloring book images
   - Pages assembled with text + images
   
3. Preview & Interaction
   ↓
   - Flip through generated pages
   - Review story and illustrations
   
4. Coloring Mode (Optional)
   ↓
   - Digital coloring in Magic Studio
   - Save colored versions
   
5. Purchase (Optional)
   ↓
   - Download full PDF
   - Order physical hardcover book
```

---

## Technical Stack

### Frontend
- **Framework**: React with Vite
- **Styling**: Tailwind CSS (or Vanilla CSS)
- **UI Components**: Custom components for story creation, preview, and coloring
- **PDF Generation**: jsPDF (client-side PDF creation)

### AI & Image Generation
- **Text Generation**: Google Gemini API
  - Model: `gemini-2.5-flash` (story structure)
  - Model: `gemini-2.5-pro` (longer stories >5 pages)
- **Image Generation**: Google Gemini API
  - Model: `gemini-2.5-flash-image` (coloring book illustrations)

### Backend & Database
- **Backend**: Supabase
  - PostgreSQL database
  - User authentication
  - Story storage
  - Shopping cart management
- **API**: Supabase RPC functions for business logic

### Payments & Commerce
- **Payment Processing**: Stripe *(Note: Configuration will change before going live)*
- **Products**:
  - Digital Story: $24.99 (25-page PDF)
  - Hardcover Book: $49.99 (8x8" physical book)

---

## Business Model (Freemium)

### Free Tier
- ✅ 5-page story generation
- ✅ Digital coloring interface
- ❌ Limited to 1 free story per user
- ❌ Includes watermarks

### Paid Products

#### Digital Story ($24.99)
- 25 pages of personalized content
- High-quality PDF download
- No watermarks
- Unlimited digital coloring

#### Hardcover Book ($49.99)
- Physical 8x8" printed book
- Professional binding
- Shipped to customer
- Includes digital version

---

## AI Model Configuration

### Story Generation
**Model**: `gemini-2.5-flash` or `gemini-2.5-pro`

**Input**:
- Child details (name, age, gender, description)
- Story category and plot
- Number of pages (5 or 25)

**Output** (JSON):
```json
{
  "title": "Leo's Magical Adventure",
  "pages": [
    {
      "text": "Once upon a time, Leo discovered a secret door...",
      "scene_description": "A high-quality coloring book line art of Leo, a 5-year-old boy with curly hair and red glasses, standing in front of a glowing door..."
    }
  ]
}
```

### Image Generation
**Model**: `gemini-2.5-flash-image`

**Input**:
- Character description (consistent across all pages)
- Scene description from story
- Style guide (black & white line art, thick outlines, no shading)

**Output**:
- Base64 encoded PNG image
- Black and white line art
- Optimized for coloring

---

## Key Files & Structure

```
CHILDTALE/
├── App.tsx                          # Main application logic
├── services/
│   └── geminiService.ts            # AI generation service
├── components/
│   ├── ColoringInterface.tsx       # Digital coloring tool
│   ├── StoryPreview.tsx           # Story page viewer
│   └── [other UI components]
├── supabase/
│   └── functions/                  # Backend functions
├── utils/
│   └── pdfGenerator.ts            # PDF creation utility
└── .env.local                      # API keys (Gemini)
```

---

## Environment Variables

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

**Note**: Stripe configuration will be updated before going live.

---

## Development Status

### ✅ Completed
- AI story generation with Gemini
- AI image generation for coloring books
- Digital coloring interface
- Basic user flow

### 🚧 In Progress / To Be Updated
- Stripe payment integration (will change before launch)
- Supabase schema finalization
- Production deployment configuration

---

## API Limits (Gemini Free Tier)

Your current Gemini API key has generous limits:
- **15 requests per minute**
- **1,500 requests per day**
- **1 million tokens per day**

This is sufficient for development and initial testing.

---

## How It Works (Technical Flow)

### Story Generation
1. User submits form with child details and story idea
2. `geminiService.generateStoryStructure()` is called
3. Gemini API returns JSON with story pages
4. Each page has text + image prompt

### Image Generation
1. For each page, `geminiService.generateColoringPage()` is called
2. Character description + scene prompt sent to Gemini
3. Gemini returns base64 image (black & white line art)
4. Image displayed in story preview

### Digital Coloring
1. User clicks "Color This Page"
2. `ColoringInterface` component loads
3. Flood-fill tool allows coloring
4. Canvas saves colored version

### PDF Generation
1. User purchases full story
2. `jsPDF` generates PDF from pages
3. PDF downloaded to user's device

---

## Future Enhancements

- [ ] Finalize Stripe integration for production
- [ ] Add more story categories
- [ ] Improve character consistency across pages
- [ ] Add parent dashboard for managing stories
- [ ] Implement print fulfillment for hardcover books
- [ ] Add sharing features (social media, email)

---

## Notes

> **Important**: Stripe configuration is temporary and will be updated before going live. Current setup is for development/testing only.

---

## Quick Start (Development)

1. Install dependencies: `npm install`
2. Set up `.env.local` with Gemini API key
3. Run dev server: `npm run dev`
4. Open http://localhost:3000
5. Create a test story!

---

*Last Updated: December 11, 2025*
