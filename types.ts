
export type StoryCategory = 'DREAM' | 'ADVENTURE' | 'MILESTONE' | 'MEMORY' | 'IMAGINATION';

export type BookStatus = 'draft' | 'purchased' | 'generating' | 'completed' | 'failed';

export type LibraryCategory =
  | 'completed'           // Successfully generated books
  | 'generating'          // Currently being created
  | 'failed_with_credit'  // Failed with regeneration credit available
  | 'unpaid_draft'        // Draft not yet paid for
  | 'pending_generation'  // Paid but not yet started generation
  | 'unknown';

export interface StoryPage {
  text: string;
  imagePrompt: string;
  generatedImage?: string; // Base64 data URI
  coloredImage?: string;   // Base64 data URI (User Colored)
}

export interface Story {
  id: string;
  createdAt: number;
  title: string;
  pages: StoryPage[];
  category: StoryCategory;
  status?: BookStatus;
  isUnlocked?: boolean; // True if is_purchased = true
  isPrinted?: boolean;  // True if ordered hardcover
  isSample?: boolean;   // True if page_count <= 5
  // Metadata for library view optimization and editing
  pageCount?: number;
  coverImage?: string;
  originalPrompt?: string; // Mapped from story_description
  childName?: string;
  childAge?: number;
  childGender?: string;
  characterDescription?: string;
  // Generation tracking
  generationAttempts?: number;
  lastGenerationAttempt?: string;
  generationError?: string;
  // Regeneration credit info
  hasRegenerationCredit?: boolean;
  orderId?: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  samplesUsed: number;
  regenerationCredits?: number; // Number of free regeneration attempts
}

export interface UserInput {
  category: StoryCategory;

  // Child Identity (Emphasized)
  childName: string;
  childAge: number;
  childGender: string; // 'Boy' | 'Girl' | 'Non-binary' | Custom

  characterDescription: string;

  // Generic main text input
  prompt: string;

  // Page Configuration
  pageCount: number;

  // Adventure specific
  location?: string;
  participants?: string;

  // Milestone specific
  milestoneType?: string;
  mood?: string;
}

export enum AppState {
  INPUT = 'INPUT',
  GENERATING_STORY = 'GENERATING_STORY',
  GENERATING_IMAGES = 'GENERATING_IMAGES',
  PREVIEW = 'PREVIEW',
  LIBRARY = 'LIBRARY',
  PRICING = 'PRICING',
  CART = 'CART',
  SHARED_VIEW = 'SHARED_VIEW',
  ERROR = 'ERROR'
}

export interface GenerationProgress {
  currentStep: string;
  progress: number; // 0 to 100
  totalImages?: number;
  completedImages?: number;
}

export interface CartItem {
  id: string; // UUID from cart table
  bookId: string;
  title: string;
  formatType: 'digital' | 'hardcover'; // Changed from type to formatType
  price: number;
  coverUrl?: string;
  childName?: string;
  addedAt?: string;
  expiresAt?: string;
}
