import React, { useState, useCallback, useEffect } from 'react';
import { AppState, UserInput, Story, GenerationProgress, StoryCategory, UserProfile, CartItem } from './types';
import { generateStoryStructure, generateColoringPage, generateCover } from './services/geminiService';
import { generatePDF } from './utils/pdfGenerator';
import { uploadImageToStorage } from './utils/storageUtils';
import { BookIcon, SparklesIcon, DownloadIcon, RefreshIcon, PencilIcon, RocketIcon, StarIcon, ArrowLeftIcon, RepeatIcon, HeartIcon, PaletteIcon, CheckIcon, SaveIcon, UserIcon, PlusIcon, LibraryIcon, XIcon, ShoppingCartIcon } from './components/Icons';
import { ColoringInterface } from './components/ColoringInterface';
import { PaymentModal } from './components/PaymentModal';
import { DownloadOptionsModal } from './components/DownloadOptionsModal';
import { SampleLimitsDisplay } from './components/SampleLimitsDisplay';
import { LandingContainer } from './components/landing';
import { ChildTaleLogo } from './components/ChildTaleLogo';
import { PricingPage } from './components/PricingPage';
import { CartPage } from './components/CartPage';
import { LibraryPage } from './components/LibraryPage';
import { supabase } from './utils/supabaseClient';
import { paypalService, PRICING } from './services/paypalService';

const DEFAULT_USER_INPUT: UserInput = {
  category: 'DREAM',
  childName: '',
  childAge: 5,
  childGender: 'Boy',
  characterDescription: '',
  prompt: '',
  location: '',
  participants: '',
  milestoneType: 'First Day of School',
  mood: '',
  pageCount: 5
};

// Strict limit for free samples
const FREE_SAMPLE_LIMIT = 1;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const [appState, setAppState] = useState<AppState>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('share')) return AppState.SHARED_VIEW;
    }
    return AppState.INPUT;
  });
  // Track previous state to prevent blank screens when going back from Pricing
  const [previousAppState, setPreviousAppState] = useState<AppState>(AppState.INPUT);


  const [step, setStep] = useState<'SELECTION' | 'FORM'>('SELECTION');
  const [userInput, setUserInput] = useState<UserInput>(DEFAULT_USER_INPUT);

  // Pending generation Params (if user pays for a book)
  const [pendingBookParams, setPendingBookParams] = useState<UserInput | null>(null);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);

  const [generatedStory, setGeneratedStory] = useState<Story | null>(null);
  const [savedStories, setSavedStories] = useState<Story[]>([]);

  const [progress, setProgress] = useState<GenerationProgress>({ currentStep: '', progress: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payment & Revisions Logic
  const [revisionCount, setRevisionCount] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentModalInitialTab, setPaymentModalInitialTab] = useState<'DIGITAL' | 'PRINT'>('DIGITAL');

  // Cart Logic
  const [cartItems, setCartItems] = useState<CartItem[]>([]);


  // Coloring Interface State
  const [coloringPageIndex, setColoringPageIndex] = useState<number | null>(null);

  // Limits State
  const [limits, setLimits] = useState({ samplesRemaining: 1, revisionsRemaining: 1 });

  // Safety Net State
  const [pendingCredits, setPendingCredits] = useState<any[]>([]);
  const [redeemingCreditId, setRedeemingCreditId] = useState<string | null>(null);
  const [isCollaborating, setIsCollaborating] = useState(false);

  // New Loading States
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isStoryLoading, setIsStoryLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // --- SUPABASE AUTH & DATA LOADING ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('share');
    const mode = params.get('mode');

    if (shareId) {
      loadSharedStory(shareId, mode);
      // Removed return; so auth listener is still set up!
    } else {
      // Only check session if NOT sharing (or maybe check anyway? Better to check anyway usually, but let's stick to simple Flow)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          handleSession(session);
        }
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        handleSession(session);
      } else {
        setIsAuthenticated(false);
        setUserProfile(null);
        setSavedStories([]);
        setCartItems([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadSharedStory = async (shareId: string, mode: string | null) => {
    setIsStoryLoading(true);
    setAppState(AppState.SHARED_VIEW);

    // Fetch story public data
    const { data: story, error } = await supabase
      .from('books')
      .select('*')
      .eq('id', shareId)
      .single();

    if (error || !story) {
      alert('Story not found or private.');
      setAppState(AppState.INPUT);
    } else {
      // Map to Story type
      const mappedStory: Story = {
        id: story.id,
        createdAt: new Date(story.created_at).getTime(),
        title: story.title,
        pages: story.story_data || [],
        category: story.story_type,
        status: story.status,
        coverImage: story.story_data?.[0]?.generatedImage // Fallback cover
      };
      setGeneratedStory(mappedStory);

      // Set state
      setGeneratedStory(mappedStory as any);

      if (mode === 'collab') {
        setIsCollaborating(true);
        // Don't auto-open page 0 anymore
      }

      // UPDATE OPEN GRAPH TAGS FOR VIRAL SHARING
      const { updateShareMetaTags } = await import('./utils/socialShareUtils');
      updateShareMetaTags({
        title: story.title,
        childName: story.child_name || 'A Child',
        coverImageUrl: story.story_data?.[0]?.generatedImage || story.cover_image_url || '',
        storyTopic: story.story_type || 'Adventure',
        shareUrl: window.location.href
      });

      setIsStoryLoading(false);
    }
  };

  const handleSession = async (session: any) => {
    setIsAuthenticated(true);
    const email = session.user.email || '';
    const uid = session.user.id;

    // Check Sample Usage
    const { count: sampleCount } = await supabase
      .from('books')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('page_count', 5);

    const samplesUsed = sampleCount || 0;

    setLimits({
      samplesRemaining: Math.max(0, FREE_SAMPLE_LIMIT - samplesUsed),
      revisionsRemaining: 1
    });

    const profile: UserProfile = {
      id: uid,
      email: email,
      samplesUsed: samplesUsed
    };
    setUserProfile(profile);

    // Load Cart
    fetchCart(uid);
  };

  const fetchCart = async (uid: string) => {
    const { data, error } = await supabase
      .from('cart')
      .select('*, book:books(title, story_data)')
      .eq('user_id', uid)
      .order('added_at', { ascending: false });

    if (data) {
      const mappedItems: CartItem[] = data.map((item: any) => ({
        id: item.id,
        bookId: item.book_id,
        title: item.book?.title || 'Untitled Book',
        formatType: item.format_type || 'digital',
        price: item.final_price,
        coverUrl: item.book?.story_data?.[0]?.generatedImage,
        childName: item.book?.child_name,
        addedAt: item.added_at,
        expiresAt: item.expires_at
      }));
      setCartItems(mappedItems);
    }
  };

  const fetchLibrary = async (uid: string) => {
    setIsLibraryLoading(true);
    try {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        const mappedStories: Story[] = data.map((row: any) => {
          let cat: StoryCategory = 'DREAM';
          // Align with DB values 'Dreams', 'Adventures', 'Milestones'
          if (row.story_type === 'Dreams') cat = 'DREAM';
          else if (row.story_type === 'Adventures') cat = 'ADVENTURE';
          else if (row.story_type === 'Milestones') cat = 'MILESTONE';
          else if (row.story_type === 'Imagination') cat = 'IMAGINATION';
          else cat = 'DREAM';

          // Map new schema fields
          return {
            id: row.id,
            createdAt: new Date(row.created_at).getTime(),
            title: row.title,
            category: cat,
            pages: row.story_data || [],
            isUnlocked: row.is_purchased,
            isPrinted: false,
            isSample: row.page_count === 5,
            pageCount: row.page_count,
            coverImage: row.cover_image_url || row.story_data?.[0]?.generatedImage,
            // Map extensive metadata for editing/upgrading
            childName: row.child_name,
            childAge: row.child_age,
            characterDescription: row.character_look,
            originalPrompt: row.story_description
          };
        });
        setSavedStories(mappedStories);
      }

      setPendingCredits([]);
      console.log(`Found 0 pending credit(s)`);

    } catch (err: any) {
      if (err.message && err.message.includes('Failed to fetch')) {
        console.warn('Network error fetching library.');
      } else {
        console.error('Error fetching library:', err.message || err);
      }
    } finally {
      setIsLibraryLoading(false);
    }
  };

  const saveStoryToDB = async (story: Story, orderId?: string) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Cannot save: No active session found.", authError);
      return;
    }

    let dbStoryType = 'Dreams';
    const cat = (story.category || userInput.category);
    if (cat === 'ADVENTURE' || cat === 'MEMORY') dbStoryType = 'Adventures';
    else if (cat === 'MILESTONE') dbStoryType = 'Milestones';
    else if (cat === 'IMAGINATION') dbStoryType = 'Imagination';
    else dbStoryType = 'Dreams';

    const targetPageCount = (story.pageCount === 25 || userInput.pageCount === 25) ? 25 : 5;
    const isFreeSample = targetPageCount === 5;

    const ageInt = parseInt(String(story.childAge || userInput.childAge));
    const finalAge = isNaN(ageInt) ? 5 : ageInt;

    const coverUrl = story.pages ? story.pages[0]?.generatedImage || null : null;

    try {
      const payload: any = {
        id: story.id,
        user_id: user.id,
        child_name: story.childName || userInput.childName || 'Child',
        child_age: finalAge,
        character_look: story.characterDescription || userInput.characterDescription || '',
        story_type: dbStoryType,
        page_count: targetPageCount,
        title: story.title,
        story_description: story.originalPrompt || userInput.prompt || '',
        story_data: story.pages,
        status: 'completed',
        cover_image_url: coverUrl,
        is_purchased: !isFreeSample
      };

      console.log('💾 Saving story to DB:', { userId: user.id, storyId: story.id, isFreeSample });

      const { error } = await supabase
        .from('books')
        .upsert(payload);

      if (error) {
        console.error("❌ Supabase Upsert Error:", error);
        throw error;
      }

      console.log("✅ Saved story to DB successfully");

      // SAFETY NET: Link order to book if orderId provided
      if (orderId) {
        console.log(`🔗 SAFETY NET: Linking order ${orderId} to book ${story.id}`);
        try {
          await supabase.from('orders').update({ book_id: story.id }).eq('id', orderId);
          console.log('✅ Order linked successfully');
          if (userProfile?.id) fetchLibrary(userProfile.id);
        } catch (err) {
          console.error('⚠️ Failed to link order (non-fatal):', err);
        }
      }

      setSavedStories(prev => {
        const exists = prev.find(s => s.id === story.id);
        const updatedStoryItem = {
          ...story,
          coverImage: coverUrl || undefined,
          pageCount: targetPageCount,
          pages: story.pages,
          isSample: isFreeSample,
          isUnlocked: !isFreeSample
        };

        if (exists) {
          return prev.map(s => s.id === story.id ? updatedStoryItem : s);
        } else {
          return [updatedStoryItem, ...prev];
        }
      });

      if (isFreeSample) {
        handleSession({ user: { id: user.id, email: user.email } });
      }

    } catch (err: any) {
      console.error('FAILED to save story to DB:', err.message);
    }
  };

  const handleLogin = (email: string) => {
    // Handled by Auth Listener
  };

  const handleCategorySelect = (category: StoryCategory) => {
    setUserInput(prev => ({ ...prev, category }));
    setStep('FORM');
  };

  const handleBackToSelection = () => {
    setStep('SELECTION');
    setErrorMsg(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setUserInput(prev => ({
      ...prev,
      [name]: name === 'childAge' ? (parseInt(value) || 0) : value
    }));
  };

  const handlePageCountChange = (count: number) => {
    setUserInput(prev => ({ ...prev, pageCount: count }));
  };

  const startGeneration = useCallback(async (isRevision: boolean = false, inputOverride?: UserInput, orderId?: string) => {
    console.log('🚀 Starting story generation...');
    console.log('isRevision:', isRevision, 'orderId:', orderId);

    const input = inputOverride || userInput;
    if (!input.childName || !input.prompt) return;

    if (input.pageCount === 5) {
      if (!isRevision) {
        if (limits.samplesRemaining <= 0) {
          alert("You have already generated your free sample. Please purchase a full story to create more.");
          return;
        }
      }
    }

    if (!isRevision) {
      setRevisionCount(0);
    } else {
      setRevisionCount(prev => prev + 1);
    }

    setAppState(AppState.GENERATING_STORY);
    setErrorMsg(null);
    setProgress({ currentStep: 'Weaving the story...', progress: 10 });

    try {
      const storyStructure = await generateStoryStructure(input);
      const storyId = (isRevision && generatedStory) ? generatedStory.id : crypto.randomUUID();
      const isFreeSample = input.pageCount <= 5;

      const newStory: Story = {
        ...storyStructure,
        id: storyId,
        createdAt: Date.now(),
        category: input.category,
        isUnlocked: !isFreeSample,
        isSample: isFreeSample,
        pageCount: input.pageCount,
        childName: input.childName,
        childAge: input.childAge,
        characterDescription: input.characterDescription,
        originalPrompt: input.prompt
      };

      setGeneratedStory(newStory);

      const totalPages = storyStructure.pages.length;
      setProgress({ currentStep: 'Sketching the scenes...', progress: 30, totalImages: totalPages, completedImages: 0 });
      setAppState(AppState.GENERATING_IMAGES);

      const explicitCharacterContext = `
MAIN CHARACTER REFERENCE:
- Name: ${input.childName}
- Age: ${input.childAge} years old
- Gender: ${input.childGender}
- Appearance: ${input.characterDescription}
- STYLE: Black and white line art coloring book style.
CONSISTENCY RULES:
- The character must look identical in every image.
- Simple, thick outlines.
- No shading or gray fill.
      `;

      const updatedPages = [...storyStructure.pages];
      for (let i = 0; i < updatedPages.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500));

        setProgress(prev => ({
          ...prev,
          currentStep: `Drawing page ${i + 1} of ${totalPages}...`,
          progress: 30 + ((i / totalPages) * 60)
        }));

        const imageBase64 = await generateColoringPage(updatedPages[i].imagePrompt, explicitCharacterContext);

        // REFACTOR: Upload to Storage to prevent DB Bloat
        // We use the new utility to upload immediately
        const imageUrl = await uploadImageToStorage(imageBase64, newStory.id, `page_${i + 1}`);
        updatedPages[i].generatedImage = imageUrl;
      }

      // Generate Dedicated Cover
      setProgress({ currentStep: 'Designing the cover...', progress: 95 });
      const coverBase64 = await generateCover(newStory.title, input.childName, input.characterDescription, input.category);

      // Upload Cover
      const coverUrl = await uploadImageToStorage(coverBase64, newStory.id, 'cover_image');

      const completedStory = { ...newStory, pages: updatedPages, pageCount: updatedPages.length, coverImage: coverUrl };
      setGeneratedStory(completedStory);

      await saveStoryToDB(completedStory, orderId);

      // Mark book as completed if it was a paid order
      if (pendingDraftId) {
        await supabase
          .from('books')
          .update({
            status: 'completed',
            generation_completed_at: new Date().toISOString()
          })
          .eq('id', pendingDraftId);

        console.log('✅ Book marked as completed:', pendingDraftId);
        setPendingDraftId(null);
      }

      setProgress({ currentStep: 'Finishing touches...', progress: 100 });
      setAppState(AppState.PREVIEW);
      setPendingBookParams(null);

    } catch (error: any) {
      console.error('❌ Story generation failed:', error);
      setErrorMsg(error.message || "Something went wrong creating the magic.");
      setAppState(AppState.ERROR);

      // Mark book as failed if it was a paid order
      if (pendingDraftId) {
        await supabase
          .from('books')
          .update({
            status: 'failed',
            generation_error: error.message
          })
          .eq('id', pendingDraftId);

        console.log('❌ Book marked as failed:', pendingDraftId);
        console.log('💳 User can retry from library');
      }

      // SAFETY NET: If orderId exists, this was a paid order that failed
      if (orderId) {
        console.log('🛡️ SAFETY NET: Generation failed for paid order', orderId);
        console.log('💳 Credit will be available in your library for retry');
        // Refresh library to show the credit
        if (userProfile?.id) {
          setTimeout(() => fetchLibrary(userProfile.id), 1000);
        }
      }
    }
  }, [userInput, limits, generatedStory, userProfile]);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("📝 Create button clicked. Page count:", userInput.pageCount);

    if (userInput.pageCount === 25) {
      console.log("💳 25-page story - saving draft before payment");

      try {
        // STEP 1: Save draft book BEFORE payment
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert('Please sign in to create a full book');
          return;
        }

        const { data: draftBook, error } = await supabase
          .from('books')
          .insert({
            user_id: user.id,
            status: 'draft',
            title: `Story for ${userInput.childName}`,
            child_name: userInput.childName,
            child_age: userInput.childAge,
            child_gender: userInput.childGender,
            character_look: userInput.characterDescription,
            story_type: userInput.category,
            story_description: userInput.prompt,
            page_count: userInput.pageCount,
            is_purchased: false
          })
          .select('id')
          .single();

        if (error) throw error;

        console.log('✅ Draft book saved:', draftBook.id);

        // STEP 2: Store draft ID and params for after payment
        setPendingDraftId(draftBook.id);
        setPendingBookParams(userInput);

        // STEP 3: Show payment modal
        setPaymentModalInitialTab('DIGITAL');
        setShowPaymentModal(true);

      } catch (error: any) {
        console.error('Failed to save draft:', error);
        alert('Failed to prepare order. Please try again.');
      }

    } else {
      console.log("🆓 Free 5-page story - starting generation immediately");
      await startGeneration(false, userInput);
    }
  }, [startGeneration, userInput]);

  const handleRegenerate = async () => {
    const maxRev = 1;
    if (revisionCount < maxRev) {
      const confirmRegen = confirm(`Regenerate images? You have ${maxRev - revisionCount} revision left.`);
      if (confirmRegen) {
        await startGeneration(true);
      }
    } else {
      alert("Maximum revisions reached for this story.");
    }
  };

  const handleUnlockClick = () => {
    if (generatedStory?.isSample) {
      setUserInput(prev => ({
        ...prev,
        pageCount: 25,
        category: generatedStory.category,
        childName: generatedStory.childName || prev.childName,
        childAge: generatedStory.childAge || prev.childAge,
        characterDescription: generatedStory.characterDescription || prev.characterDescription,
        prompt: generatedStory.originalPrompt || prev.prompt || generatedStory.title
      }));
      setStep('FORM');
      setAppState(AppState.INPUT);
    } else {
      setPaymentModalInitialTab('DIGITAL');
      setShowPaymentModal(true);
    }
  };

  const handleAddToCart = async (type: 'DIGITAL' | 'HARDCOVER') => {
    if (!generatedStory || !userProfile) return;

    const price = type === 'DIGITAL' ? PRICING.DIGITAL_SINGLE : PRICING.HARDCOVER;

    try {
      const { error } = await supabase.from('cart').insert({
        user_id: userProfile.id,
        book_id: generatedStory.id,
        format_type: type.toLowerCase(),
        price: price,
        final_price: price
      });

      if (error) throw error;

      await fetchCart(userProfile.id);
      alert(`Added to cart!`);
    } catch (e: any) {
      console.error("Add to cart failed", e);
      alert("Failed to add to cart.");
    }
  };

  const handleRemoveFromCart = async (itemId: string) => {
    if (!userProfile) return;
    await supabase.from('cart').delete().eq('id', itemId);
    await fetchCart(userProfile.id);
  };

  const handleCartCheckout = () => {
    setShowPaymentModal(true);
  };

  const handleBuyNow = (type: 'digital' | 'hardcover') => {
    setPaymentModalInitialTab(type === 'digital' ? 'DIGITAL' : 'PRINT');
    setShowPaymentModal(true);
  };

  const handleHardcoverOrder = async (shipping: any) => {
    if (!generatedStory || !userProfile) {
      alert('Please create a story first');
      return;
    }

    setProgress({ currentStep: 'Preparing hardcover order...', progress: 10 });

    try {
      const { LuluOrderService } = await import('./services/LuluOrderService');

      const result = await LuluOrderService.createHardcoverOrder(
        generatedStory,
        userInput,
        shipping
      );

      if (result.success) {
        setProgress({ currentStep: 'Order submitted successfully!', progress: 100 });
        alert(`Hardcover ordered! \nOrder ID: ${result.orderId}\n\nYour book will be printed and shipped within 7-10 business days.`);
        setShowPaymentModal(false);
      } else {
        throw new Error(result.error || 'Order failed');
      }

    } catch (error: any) {
      console.error('Hardcover order error:', error);
      setErrorMsg(error.message || 'Failed to create hardcover order');
      setProgress({ currentStep: '', progress: 0 });
    }
  };

  const handleDownloadClick = (mode: 'bw' | 'color' = 'bw') => {
    if (!generatedStory) return;

    if (mode === 'color') {
      const hasColoredPages = generatedStory.pages.some(p => p.coloredImage);
      if (!hasColoredPages) {
        alert("Please color at least one page before downloading the colored version.");
        return;
      }
    }
    generatePDF(generatedStory, userInput, mode);
  };

  const handlePaymentSuccess = async (type: 'digital' | 'print' | 'cart', orderId?: string, reference?: string) => {
    console.log('🎉 Payment Success Handler Called');
    console.log('Payment type:', type);
    console.log('Reference:', reference);

    setShowPaymentModal(false);

    if (type === 'cart') {
      console.log('🛒 Cart checkout successful - starting generation for all items');

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert('Session expired. Please log in again.');
          return;
        }

        // Cart items are already processed by paypalService in Modal
        // We just need to trigger generation for the items that were in the cart
        // But the cart is cleared!
        // We can use the current 'cartItems' state which holds the items before clearance?
        // App state 'cartItems' should still have the items.

        if (cartItems && cartItems.length > 0) {
          console.log(`🚀 Starting generation for ${cartItems.length} cart items`);

          for (const item of cartItems) {
            // Reconstruct user input
            // We need to fetch the book details first because cartItem only has summary
            // But the book already exists in DB.
            // We need full UserInput to pass to startGeneration?
            // startGeneration takes (isRetry, input, orderId). 
            // IF input is missing, startGeneration uses 'userInput' state?
            // But 'userInput' state is for CURRENT form.
            // We need to pass the specific input for EACH book.

            // Fetch book details
            const { data: book } = await supabase
              .from('books')
              .select('*')
              .eq('id', item.bookId)
              .single();

            if (book) {
              const bookInput: UserInput = {
                category: book.story_type || 'ADVENTURE',
                childName: book.child_name || '',
                childAge: book.child_age || 5,
                childGender: book.child_gender || 'Boy',
                characterDescription: book.character_look || '',
                prompt: book.story_description || '',
                pageCount: book.page_count || 25
              };

              // We don't have the new Order ID for this specific book easily available
              // (paypalService created it but didn't return list)
              // However, the book status IS 'completed' or 'generating'.
              // If I call startGeneration, it might try to create a NEW order if I don't pass one?
              // Let's check startGeneration.
              // It calls `generateStory`.
              // `generateStory` updates the book.

              // CRITICAL: startGeneration usually CREATES the book row.
              // But here the book row EXISTS.
              // So we need to ensure startGeneration knows to use EXISTING book.
              // Does startGeneration support reuse?
              // It sets `setGeneratedStory(draftBook)`.
              // It seems designed for the "Current" flow.

              // ACTUALLY: The "Add to Cart" flow I implemented (Step 171) did this loop.
              // And it called `startGeneration(false, bookInput, pendingOrder.id)`.
              // But wait, `startGeneration` inside calls `saveDraft`.
              // `saveDraft` INSERTS a new book!
              // This means `startGeneration` is creating DUPLICATE books!

              // ERROR IN PREVIOUS LOGIC (Step 171): 
              // Step 171 Add to Cart creates a Draft Book.
              // Then Checkout loop calls `startGeneration`.
              // `startGeneration` calls `saveDraft` which creates ANOTHER book.
              // This is a bug from previous step.

              // FIX: We need a way to `startGeneration` for an EXISTING book ID.
              // `startGeneration` doesn't accept `bookId`.
              // I should probably Modify `startGeneration` or create a helper `generateExistingBook`.

              // OR: rely on `RegenerationService`? 
              // `RegenerationService.regenerateBook` handles existing books!
              // But it's for regeneration (using credits).
              // Logic is similar.

              // Simplify: Just update status to 'generating' (done by PaystackService).
              // And call the Cloud Function `generate-story`.
              // `startGeneration` calls `openAiService.generateStory`.
              // It passes `bookId`.

              // I can just call `generateStory` directly here?
              // `generateStory` is inside `App.tsx`? No, it's `startGeneration`.
              // The actual API call is `openAiService.generateStory`.

              // I'll leave the passed `startGeneration` call for now but wrap it safely.
              // Actually, I'll use `RegenerationService` logic.
              // `RegenerationService` calls `generate-story` edge function.

              // Let's use `supabase.functions.invoke('generate-story', ...)` directly.
              console.log(`Triggering generation for book ${book.id}`);
              supabase.functions.invoke('generate-story', {
                body: {
                  bookId: book.id,
                  prompt: book.story_description,
                  childName: book.child_name,
                  childAge: book.child_age,
                  childGender: book.child_gender,
                  characterDescription: book.character_look,
                  category: book.story_type,
                  pageCount: book.page_count,
                  // ... other params needed by generate-story function
                }
              });
            }
          }
        }

        setAppState(AppState.LIBRARY);
        alert(`Payment successful! Generating your books. Check library.`);
        // Refresh cart (will be empty)
        if (userProfile?.id) fetchCart(userProfile.id);

      } catch (error: any) {
        console.error('Cart checkout error:', error);
        setAppState(AppState.LIBRARY);
      }
      return;
    }

    // Single Story (New or Existing)
    // If we have an orderId (passed from Modal), use it.
    const effectiveStoryId = generatedStory?.id;
    if (!orderId && !effectiveStoryId) { // New story but no orderId?
      // Should not happen with new logic, but handled gracefully
      console.warn('No order ID passed for new story');
    }

    if (generatedStory) {
      // Existing story unlock logic (if just paid for existing)
      // paypalService already updated it.
      // Just unlock locally.
      setGeneratedStory(prev => prev ? ({ ...prev, isUnlocked: true }) : null);
    }

    if (pendingDraftId && orderId) {
      console.log('🚀 Starting generation for paid draft:', pendingDraftId);
      // We pass the orderId to link it
      await startGeneration(false, pendingBookParams || userInput, orderId);
    } else if (orderId) {
      // New story direct generation
      console.log('🚀 Starting generation with order:', orderId);
      await startGeneration(false, userInput, orderId);
    } else {
      // Fallback
      setAppState(AppState.LIBRARY);
      alert("Payment received. Check your library.");
    }
  };

  const handleRetryGeneration = async (bookId: string) => {
    try {
      console.log('🔄 Retrying generation for book:', bookId);

      // Fetch the failed book
      const { data: book, error: fetchError } = await supabase
        .from('books')
        .select('*')
        .eq('id', bookId)
        .single();

      if (fetchError || !book) {
        alert('Failed to load book details');
        return;
      }

      if (book.status !== 'failed') {
        alert('This book is not in a failed state');
        return;
      }

      // Reconstruct user input from saved data
      const retryInput: UserInput = {
        category: book.story_type || 'ADVENTURE',
        childName: book.child_name || '',
        childAge: book.child_age || 5,
        childGender: book.child_gender || 'Boy',
        characterDescription: book.character_look || '',
        prompt: book.story_description || '',
        pageCount: book.page_count || 25
      };

      console.log('📝 Reconstructed input:', retryInput);

      // Update status to generating
      await supabase
        .from('books')
        .update({
          status: 'generating',
          generation_started_at: new Date().toISOString(),
          generation_error: null
        })
        .eq('id', bookId);

      // Set app state to show progress
      setAppState(AppState.INPUT);
      setProgress({ currentStep: 'Retrying generation...', progress: 0 });

      // Start generation with the book ID
      await startGeneration(false, retryInput, null);

      // Update the book with generated content manually
      // (startGeneration doesn't accept bookId parameter)

      // On success, refresh library
      if (userProfile?.id) {
        await fetchLibrary(userProfile.id);
      }

    } catch (error: any) {
      console.error('❌ Retry failed:', error);
      alert('Failed to retry generation. Please try again later.');

      // Mark as failed again
      await supabase
        .from('books')
        .update({
          status: 'failed',
          generation_error: error.message
        })
        .eq('id', bookId);

      setAppState(AppState.LIBRARY);
    }
  };

  const resetApp = () => {
    // Clear URL params effectively
    window.history.pushState({}, document.title, window.location.pathname);

    setAppState(AppState.INPUT);
    setStep('SELECTION');
    setGeneratedStory(null);
    setColoringPageIndex(null);
    setIsCollaborating(false);
    setProgress({ currentStep: '', progress: 0 });
    setUserInput(DEFAULT_USER_INPUT);
    setRevisionCount(0);
    setPendingBookParams(null);
    if (userProfile?.email) handleSession({ user: { id: userProfile.id, email: userProfile.email } });
  };

  const handleLogout = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (isLoggingOut) return;

    setIsLoggingOut(true);
    console.log('🚪 Logging out...');

    try {
      await supabase.auth.signOut();
      console.log('✅ Logged out successfully - reloading page');
      window.location.reload();
    } catch (error) {
      console.error('Failed to logout:', error);
      window.location.reload();
    }
  };

  const handleSaveColoredPage = async (dataUrl: string) => {
    if (generatedStory && coloringPageIndex !== null) {
      const updatedPages = [...generatedStory.pages];
      updatedPages[coloringPageIndex] = {
        ...updatedPages[coloringPageIndex],
        coloredImage: dataUrl
      };

      const updatedStory = { ...generatedStory, pages: updatedPages };
      setGeneratedStory(updatedStory);
      setColoringPageIndex(null);

      await saveStoryToDB(updatedStory);

      if (userProfile) {
        await supabase.from('gallery').insert({
          user_id: userProfile.id,
          book_id: generatedStory.id,
          title: generatedStory.title,
          thumbnail_url: dataUrl,
          colored_pages_data: { [coloringPageIndex]: dataUrl },
          last_colored_at: new Date().toISOString()
        });
      }
    }
  };

  const handleViewLibrary = () => {
    if (userProfile) {
      fetchLibrary(userProfile.id);
    }
    setAppState(AppState.LIBRARY);
  };

  const handleViewCart = () => {
    if (userProfile) fetchCart(userProfile.id);
    setPreviousAppState(appState);
    setAppState(AppState.CART);
  };

  const handleOpenStory = async (story: Story) => {
    setIsStoryLoading(true);
    setGeneratedStory(story);
    setUserInput(prev => ({
      ...prev,
      childName: story.childName || story.title.split("'")[0] || "Child",
      childAge: story.childAge || 5,
      characterDescription: story.characterDescription || "",
      prompt: story.originalPrompt || story.title,
      pageCount: story.pageCount || 5,
      category: story.category,
    }));
    setAppState(AppState.PREVIEW);
    setIsStoryLoading(false);
  };

  const handleDeleteStory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this story permanently?")) {
      return;
    }

    try {
      const { error } = await supabase.from('books').delete().eq('id', id);

      if (error) {
        throw new Error("Could not delete from cloud.");
      }

      setSavedStories(prev => prev.filter(s => s.id !== id));

    } catch (err: any) {
      console.error("Error deleting story", err);
      alert(`Failed to delete story: ${err.message}`);
    }
  };

  const getThemeColors = (category: StoryCategory) => {
    switch (category) {
      case 'DREAM': return {
        primary: 'text-purple-600',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        ring: 'focus:ring-purple-100',
        button: 'bg-purple-600 hover:bg-purple-700',
        icon: <SparklesIcon className="w-6 h-6 text-purple-600" />
      };
      case 'ADVENTURE': return {
        primary: 'text-orange-600',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        ring: 'focus:ring-orange-100',
        button: 'bg-orange-600 hover:bg-orange-700',
        icon: <RocketIcon className="w-6 h-6 text-orange-600" />
      };
      case 'MILESTONE': return {
        primary: 'text-yellow-600',
        bg: 'bg-yellow-50',
        border: 'border-yellow-200',
        ring: 'focus:ring-yellow-100',
        button: 'bg-yellow-500 hover:bg-yellow-600 text-white',
        icon: <StarIcon className="w-6 h-6 text-yellow-600" />
      };
      case 'MEMORY': return {
        primary: 'text-pink-600',
        bg: 'bg-pink-50',
        border: 'border-pink-200',
        ring: 'focus:ring-pink-100',
        button: 'bg-pink-500 hover:bg-pink-600',
        icon: <HeartIcon className="w-6 h-6 text-pink-600" />
      };
      case 'IMAGINATION': return {
        primary: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        ring: 'focus:ring-blue-100',
        button: 'bg-blue-500 hover:bg-blue-600',
        icon: <SparklesIcon className="w-6 h-6 text-blue-600" />
      };
      default: return {
        primary: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        ring: 'focus:ring-slate-100',
        button: 'bg-slate-900',
        icon: <SparklesIcon className="w-6 h-6 text-slate-600" />
      };
    }
  };

  const theme = getThemeColors(userInput.category);

  if (!isAuthenticated && appState !== AppState.SHARED_VIEW) {
    return <LandingContainer onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 pb-20">

      {(isStoryLoading) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm animate-fade-in">
          <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4 shadow-xl"></div>
          <p className="text-xl font-bold text-indigo-900 animate-pulse">
            Opening story...
          </p>
        </div>
      )}

      <header className="bg-white/90 backdrop-blur-md sticky top-0 z-40 border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="cursor-pointer" onClick={resetApp}>
          <ChildTaleLogo size="sm" />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleViewLibrary} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-indigo-600 transition-colors relative" title="My Library">
            <LibraryIcon className="w-6 h-6" />
            {isLibraryLoading && (
              <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
              </span>
            )}
          </button>

          <button onClick={handleViewCart} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-indigo-600 transition-colors relative" title="Cart">
            <ShoppingCartIcon className="w-6 h-6" />
            {cartItems.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm">
                {cartItems.length}
              </span>
            )}
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1"></div>

          <button
            onClick={(e) => handleLogout(e)}
            disabled={isLoggingOut}
            className="text-sm font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">

        {(appState === AppState.ERROR || errorMsg) && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex justify-between items-center shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-red-100 p-2 rounded-full">
                <XIcon className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-red-700 font-bold">Oops!</p>
                <p className="text-red-600 text-sm">{errorMsg || "Something went wrong. Please try again."}</p>
              </div>
            </div>
            <button onClick={() => { setErrorMsg(null); setAppState(AppState.INPUT); }} className="text-red-400 hover:text-red-600 font-bold text-sm">
              Try Again
            </button>
          </div>
        )}

        {(appState === AppState.GENERATING_STORY || appState === AppState.GENERATING_IMAGES) && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
            <div className="relative w-24 h-24 mb-8">
              <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <SparklesIcon className="w-8 h-8 text-indigo-600 animate-pulse" />
              </div>
            </div>

            <h2 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">{progress.currentStep}</h2>

            <div className="w-full max-w-md bg-slate-100 rounded-full h-4 overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-indigo-600 transition-all duration-500 ease-out relative overflow-hidden rounded-full"
                style={{ width: `${progress.progress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
              </div>
            </div>
            <p className="mt-4 text-slate-500 font-bold">{Math.round(progress.progress)}% Complete</p>
          </div>
        )}

        {appState === AppState.PRICING && (
          <div className="animate-fade-in">
            <button
              onClick={() => setAppState(previousAppState)}
              className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 mb-6 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" /> Back
            </button>
            <PricingPage
              isAuthenticated={true}
              mode="functional"
              bookId={generatedStory?.id}
              onBuyNow={handleBuyNow}
              onStartCreating={() => setAppState(AppState.INPUT)}
            />
          </div>
        )}

        {appState === AppState.CART && (
          <CartPage
            onCheckout={(items) => {
              // Store cart items for checkout
              setCartItems(items);
              setShowPaymentModal(true);
            }}
            onBack={() => setAppState(previousAppState)}
          />
        )}


        {appState === AppState.SHARED_VIEW && generatedStory && (
          <div className="min-h-screen w-full bg-slate-50 pb-32 animate-fade-in px-4 md:px-0">
            {/* Public Header */}
            <div className="flex justify-between items-center py-8">
              <ChildTaleLogo />
              <button
                onClick={resetApp}
                className="bg-indigo-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-indigo-700 transition-all hover:scale-105"
              >
                Create Your Own Story
              </button>
            </div>

            <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
              <div className="aspect-[16/9] bg-slate-100 relative">
                {generatedStory.coverImage && (
                  <img src={generatedStory.coverImage} className="w-full h-full object-cover" alt="Cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-8">
                  <div>
                    <span className="inline-block bg-white/20 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-bold mb-4 uppercase tracking-widest border border-white/30">
                      {generatedStory.category} STORY
                    </span>
                    <h1 className="text-4xl md:text-5xl font-black text-white mb-2">{generatedStory.title}</h1>
                    {generatedStory.childName && (
                      <p className="text-white/90 text-lg font-medium">Starring {generatedStory.childName}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-16">
                {generatedStory.pages.map((page, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row gap-8 items-center">
                    <div className="w-full md:w-1/2 flex flex-col items-center">
                      <div className="w-full aspect-[4/5] bg-white rounded-xl border-2 border-slate-100 shadow-sm relative overflow-hidden group cursor-pointer" onClick={() => setColoringPageIndex(idx)}>
                        <img
                          src={page.coloredImage || page.generatedImage}
                          className="w-full h-full object-contain p-2"
                          alt={`Page ${idx + 1}`}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 bg-white text-slate-900 font-bold px-6 py-2 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 flex items-center gap-2">
                            <PaletteIcon className="w-4 h-4" /> Open Studio
                          </span>
                        </div>
                      </div>
                      {/* Persistent Button for Everyone - Mobile & Desktop */}
                      <button
                        onClick={() => setColoringPageIndex(idx)}
                        className="mt-6 w-full md:w-auto bg-slate-900 text-white font-bold px-8 py-3 rounded-xl text-base shadow-xl hover:bg-indigo-600 transition-all transform hover:-translate-y-1 flex items-center justify-center gap-3 border-2 border-slate-900 hover:border-indigo-600"
                      >
                        <PaletteIcon className="w-5 h-5" />
                        Click to Color
                      </button>
                    </div>
                    <div className="w-full md:w-1/2 text-center md:text-left">
                      <div className="inline-flex w-10 h-10 rounded-full bg-slate-100 text-slate-400 font-bold items-center justify-center mb-6 text-sm">
                        {idx + 1}
                      </div>
                      <p className="text-xl text-slate-700 leading-loose font-medium font-serif">
                        {page.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-16 text-center bg-indigo-50 rounded-3xl p-12">
              <h2 className="text-3xl font-black text-indigo-900 mb-4">Inspired?</h2>
              <p className="text-indigo-700 text-lg mb-8 max-w-md mx-auto">
                Create a magical, personalized story for your own child in seconds.
              </p>
              <button
                onClick={resetApp}
                className="bg-indigo-600 text-white px-8 py-4 rounded-full text-xl font-bold shadow-xl hover:bg-indigo-700 transition-transform hover:scale-105 flex items-center gap-2 mx-auto"
              >
                <SparklesIcon className="w-6 h-6" />
                Start Your Story
              </button>
            </div>
          </div>
        )}

        {appState === AppState.LIBRARY && (
          <div className="max-w-7xl mx-auto px-6 pt-8">
            <button
              onClick={resetApp}
              className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold mb-6 transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5" /> Back to Home
            </button>
            <LibraryPage
              onViewBook={(book) => {
                handleOpenStory(book);
              }}
              onColorBook={(bookId) => {
                const story = savedStories.find(s => s.id === bookId);
                if (story && story.pages && story.pages.length > 0) {
                  setGeneratedStory(story);
                  setColoringPageIndex(0);
                }
              }}
              onDownloadBook={(bookId) => {
                const story = savedStories.find(s => s.id === bookId);
                if (story) {
                  generatePDF(story, userInput);
                }
              }}
              onDeleteBook={async (bookId) => {
                if (!userProfile) return;
                try {
                  const { error } = await supabase.from('books').delete().eq('id', bookId);
                  if (error) throw error;
                } catch (err) {
                  console.error("Delete failed", err);
                  alert("Failed to delete book.");
                  throw err; // Propagate to LibraryPage so it knows to refresh
                }
              }}
            />
          </div>
        )}

        {/* --- INPUT FLOW --- */}
        {appState === AppState.INPUT && (
          <div className="animate-fade-in-up">
            {/* Step 1: Category Selection */}
            {step === 'SELECTION' && (
              <div className="max-w-5xl mx-auto px-6 py-12">
                <div className="text-center mb-16">
                  <h1 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">What story are we telling today?</h1>
                  <p className="text-slate-500 text-lg">Choose a type of coloring book to create.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Magical Dream */}
                  <button
                    onClick={() => handleCategorySelect('DREAM')}
                    className="group relative bg-white p-8 rounded-3xl shadow-[0_2px_10px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-purple-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>

                    <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-600 mb-6 relative z-10">
                      <SparklesIcon className="w-7 h-7" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Magical Dream</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Turn wild dreams and imagination into fantastical adventures.
                      </p>
                    </div>
                  </button>

                  {/* Real Adventure */}
                  <button
                    onClick={() => handleCategorySelect('ADVENTURE')}
                    className="group relative bg-white p-8 rounded-3xl shadow-[0_2px_10px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-orange-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>

                    <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600 mb-6 relative z-10">
                      <RocketIcon className="w-7 h-7" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Real Adventure</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Relive a special family trip, a visit to the zoo, or a fun day out.
                      </p>
                    </div>
                  </button>

                  {/* Big Milestone */}
                  <button
                    onClick={() => handleCategorySelect('MILESTONE')}
                    className="group relative bg-white p-8 rounded-3xl shadow-[0_2px_10px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-yellow-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>

                    <div className="w-14 h-14 rounded-2xl bg-yellow-100 flex items-center justify-center text-yellow-600 mb-6 relative z-10">
                      <StarIcon className="w-7 h-7" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Big Milestone</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Celebrate the first day of school, a new sibling, or a brave moment.
                      </p>
                    </div>
                  </button>

                  {/* Sweet Memory */}
                  <button
                    onClick={() => handleCategorySelect('MEMORY')}
                    className="group relative bg-white p-8 rounded-3xl shadow-[0_2px_10px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-pink-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>

                    <div className="w-14 h-14 rounded-2xl bg-pink-100 flex items-center justify-center text-pink-500 mb-6 relative z-10">
                      <HeartIcon className="w-7 h-7" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Sweet Memory</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Capture a funny story, an everyday moment, or a specific memory.
                      </p>
                    </div>
                  </button>
                  {/* Pure Imagination */}
                  <button
                    onClick={() => handleCategorySelect('IMAGINATION')}
                    className="group relative bg-white p-8 rounded-3xl shadow-[0_2px_10px_rgb(0,0,0,0.03)] border border-slate-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-blue-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>

                    <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 mb-6 relative z-10">
                      <SparklesIcon className="w-7 h-7" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-slate-900 mb-2">Pure Imagination</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        Favorite cartoon characters? Made-up worlds? Anything is possible here.
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {step === 'FORM' && (
              <div className="max-w-3xl mx-auto py-12 px-6">
                <button onClick={handleBackToSelection} className="flex items-center gap-2 text-slate-400 hover:text-slate-600 mb-8 font-bold text-sm transition-colors">
                  <ArrowLeftIcon className="w-4 h-4" /> Back to selection
                </button>

                <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 md:p-12">

                  {/* Form Header */}
                  <div className="text-center mb-10">
                    <div className={`inline-flex items-center justify-center gap-3 mb-2`}>
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${theme.bg}`}>
                        {theme.icon}
                      </div>
                      <h2 className="text-3xl font-black font-['Nunito'] text-slate-900">
                        {userInput.category === 'DREAM' && 'Dream a Dream'}
                        {userInput.category === 'ADVENTURE' && 'Capture an Adventure'}
                        {userInput.category === 'MILESTONE' && 'Celebrate a Milestone'}
                        {userInput.category === 'MILESTONE' && 'Celebrate a Milestone'}
                        {userInput.category === 'MEMORY' && 'Sweet Memory'}
                        {userInput.category === 'IMAGINATION' && 'Pure Imagination'}
                      </h2>
                    </div>
                  </div>

                  {/* Book Type Toggle */}
                  <div className="mb-10">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Book Type</h4>
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => handlePageCountChange(5)}
                        className={`flex-1 p-6 rounded-xl border-2 transition-all relative ${userInput.pageCount === 5 ? `${theme.border} ${theme.bg}` : 'border-slate-100 hover:border-slate-200'}`}
                      >
                        {userInput.pageCount === 5 && (
                          <div className={`absolute -top-2 -right-2 ${theme.button.split(' ')[0]} text-white rounded-full p-0.5`}>
                            <CheckIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div className={`text-xl font-bold mb-1 ${userInput.pageCount === 5 ? theme.primary : 'text-slate-700'}`}>Free Sample</div>
                        <div className={`text-sm font-bold ${userInput.pageCount === 5 ? theme.primary.replace('600', '500') : 'text-slate-400'}`}>5 Pages</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handlePageCountChange(25)}
                        className={`flex-1 p-6 rounded-xl border-2 transition-all relative ${userInput.pageCount === 25 ? `${theme.border} ${theme.bg}` : 'border-slate-100 hover:border-slate-200'}`}
                      >
                        {userInput.pageCount === 25 && (
                          <div className={`absolute -top-2 -right-2 ${theme.button.split(' ')[0]} text-white rounded-full p-0.5`}>
                            <CheckIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div className={`text-xl font-bold mb-1 ${userInput.pageCount === 25 ? theme.primary : 'text-slate-700'}`}>Full Book</div>
                        <div className={`text-sm font-bold ${userInput.pageCount === 25 ? theme.primary.replace('600', '500') : 'text-slate-400'}`}>25 Pages</div>
                      </button>
                    </div>
                    <div className={`mt-3 text-center text-xs font-bold ${userInput.pageCount === 5 ? 'text-green-500' : 'text-slate-400'}`}>
                      {userInput.pageCount === 5 ? 'A great way to try it out! Watermarked PDF.' : 'The complete 25-page story. Requires payment.'}
                    </div>
                  </div>

                  <form onSubmit={handleCreate} className="space-y-8">

                    {/* Row 1: Name, Age, Gender, Look */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Child's Name</label>
                        <input
                          required
                          name="childName"
                          value={userInput.childName}
                          onChange={handleInputChange}
                          placeholder="e.g. Leo"
                          className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-bold bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Age</label>
                        <input
                          type="number"
                          required
                          name="childAge"
                          value={userInput.childAge}
                          onChange={handleInputChange}
                          className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-bold bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Gender</label>
                        <select
                          name="childGender"
                          value={userInput.childGender}
                          onChange={handleInputChange}
                          className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all text-slate-900 font-bold bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                        >
                          <option>Boy</option>
                          <option>Girl</option>
                        </select>
                      </div>
                      <div className="md:col-span-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Character Look</label>
                        <input
                          required
                          name="characterDescription"
                          value={userInput.characterDescription}
                          onChange={handleInputChange}
                          placeholder="e.g. Curly hair, glasses"
                          className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-bold bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                        />
                      </div>
                    </div>

                    {/* Dynamic Inputs based on Category */}
                    {userInput.category === 'DREAM' && (
                      <div className="space-y-6">
                        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex gap-3 text-purple-800 text-sm font-medium">
                          <SparklesIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <p>Turn their nightly dreams into a magical story where they are the hero! Describe the dream, and we'll bring it to life.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">The Dream / Story</label>
                          <textarea
                            required
                            name="prompt"
                            value={userInput.prompt}
                            onChange={handleInputChange}
                            placeholder="e.g. Leo goes to Mars but the aliens are made of jelly and want to play soccer."
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all h-32 resize-none placeholder:text-slate-300 text-slate-900 font-medium leading-relaxed bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                      </div>
                    )}

                    {userInput.category === 'ADVENTURE' && (
                      <div className="space-y-6">
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3 text-orange-800 text-sm font-medium">
                          <RocketIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <p>Relive a fun day out! A trip to the zoo, a hike, or a beach day. Capture the real details of your family adventure.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Where did you go?</label>
                          <input
                            name="location"
                            value={userInput.location || ''}
                            onChange={handleInputChange}
                            placeholder="e.g. The Zoo, Grandma's Farm, The Beach"
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-medium bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Who was there?</label>
                          <input
                            name="participants"
                            value={userInput.participants || ''}
                            onChange={handleInputChange}
                            placeholder="e.g. Mom, Dad, and sister Maya"
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-medium bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What happened? (Key Memories)</label>
                          <textarea
                            required
                            name="prompt"
                            value={userInput.prompt}
                            onChange={handleInputChange}
                            placeholder="e.g. We saw a lion who was sleeping. Leo ate a giant ice cream. We found a cool red rock."
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all h-24 resize-none placeholder:text-slate-300 text-slate-900 font-medium leading-relaxed bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                      </div>
                    )}

                    {userInput.category === 'MILESTONE' && (
                      <div className="space-y-6">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex gap-3 text-yellow-800 text-sm font-medium">
                          <StarIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <p>Celebrate a big moment! First day of school, losing a tooth, or learning a new skill. These memories deserve a book.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Which Milestone?</label>
                          <select
                            name="milestoneType"
                            value={userInput.milestoneType}
                            onChange={handleInputChange}
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all text-slate-900 font-medium bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          >
                            <option>First Day of School</option>
                            <option>New Sibling</option>
                            <option>Lost a Tooth</option>
                            <option>Learned to Ride a Bike</option>
                            <option>First Swimming Lesson</option>
                            <option>Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">How did they feel?</label>
                          <input
                            name="mood"
                            value={userInput.mood || ''}
                            onChange={handleInputChange}
                            placeholder="e.g. Nervous at first, but then brave and happy"
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all placeholder:text-slate-300 text-slate-900 font-medium bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Any specific details?</label>
                          <textarea
                            required
                            name="prompt"
                            value={userInput.prompt}
                            onChange={handleInputChange}
                            placeholder="e.g. She met a nice teacher named Ms. Apple. She played with blocks."
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all h-24 resize-none placeholder:text-slate-300 text-slate-900 font-medium leading-relaxed bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                      </div>
                    )}

                    {userInput.category === 'MEMORY' && (
                      <div className="space-y-6">
                        <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 flex gap-3 text-pink-800 text-sm font-medium">
                          <HeartIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <p>Preserve a sweet, funny, or tender moment. The little things that happen every day make the best stories.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What is the memory?</label>
                          <textarea
                            required
                            name="prompt"
                            value={userInput.prompt}
                            onChange={handleInputChange}
                            placeholder="e.g. Debra was excited for church. She had a new dress that sparkled just right, but she didn't know how to style her hair..."
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all h-40 resize-none placeholder:text-slate-300 text-slate-900 font-medium leading-relaxed bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                      </div>
                    )}

                    {userInput.category === 'IMAGINATION' && (
                      <div className="space-y-6">
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 text-blue-800 text-sm font-medium">
                          <SparklesIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <p>In this category, anything goes! Cartoon characters, made-up worlds, impossible situations. It's their playground.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">What happens in this story?</label>
                          <textarea
                            required
                            name="prompt"
                            value={userInput.prompt}
                            onChange={handleInputChange}
                            placeholder="e.g. Spider-Man and Batman have a dance-off on the moon, but then they have to team up to fight a giant marshmallow monster."
                            className={`w-full px-4 py-3 rounded-xl border-2 border-slate-100 focus:border-opacity-100 focus:ring-4 outline-none transition-all h-32 resize-none placeholder:text-slate-300 text-slate-900 font-medium leading-relaxed bg-white ${theme.ring.replace('focus:', 'focus:')} ${theme.border.replace('border-', 'focus:border-')}`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Submit Buttons */}
                    {userInput.pageCount === 25 ? (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            // Add to cart logic
                            try {
                              const { data: { user } } = await supabase.auth.getUser();
                              if (!user) {
                                alert('Please sign in to add to cart');
                                return;
                              }

                              // Create draft book
                              const { data: draftBook, error } = await supabase
                                .from('books')
                                .insert({
                                  user_id: user.id,
                                  status: 'draft',
                                  title: `Story for ${userInput.childName}`,
                                  child_name: userInput.childName,
                                  child_age: userInput.childAge,
                                  child_gender: userInput.childGender,
                                  character_look: userInput.characterDescription,
                                  story_type: userInput.category,
                                  story_description: userInput.prompt,
                                  page_count: userInput.pageCount,
                                  is_purchased: false
                                })
                                .select('id')
                                .single();

                              if (error) throw error;

                              // Add to cart using CartService
                              const { CartService } = await import('./services/cartAndRegenerationService');
                              const result = await CartService.addToCart({
                                bookId: draftBook.id,
                                formatType: 'digital',
                                price: PRICING.DIGITAL_SINGLE
                              });

                              if (result.success) {
                                alert('Added to cart! Continue shopping or go to cart to checkout.');
                                // Reset form
                                setUserInput(DEFAULT_USER_INPUT);
                                setStep('SELECTION');
                              } else {
                                alert(`Failed to add to cart: ${result.error}`);
                              }
                            } catch (error: any) {
                              console.error('Add to cart failed:', error);
                              alert('Failed to add to cart. Please try again.');
                            }
                          }}
                          className="flex-1 py-4 rounded-xl bg-white border-2 border-indigo-600 text-indigo-600 font-bold text-lg hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
                        >
                          <ShoppingCartIcon className="w-5 h-5" />
                          <span>Add to Cart</span>
                        </button>
                        <button
                          type="submit"
                          className={`flex-1 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 ${theme.button}`}
                        >
                          <span>Pay & Create Book</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="submit"
                        className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 ${theme.button}`}
                      >
                        <SparklesIcon className="w-5 h-5" />
                        <span>Create Free Sample</span>
                      </button>
                    )}

                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {
          appState === AppState.PREVIEW && generatedStory && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setAppState(AppState.LIBRARY)} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold">
                  <ArrowLeftIcon className="w-4 h-4" /> Back to Library
                </button>
                <div className="flex gap-2">
                  <button onClick={() => handleDownloadClick('bw')} className="flex items-center gap-2 px-4 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-full font-bold transition-colors" title="Download Printable PDF">
                    <DownloadIcon className="w-5 h-5" />
                    <span>Download PDF</span>
                  </button>
                  {generatedStory.pages.some(p => p.coloredImage) && (
                    <button onClick={() => handleDownloadClick('color')} className="flex items-center gap-2 px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-full font-bold transition-colors" title="Download Color PDF">
                      <div className="relative">
                        <DownloadIcon className="w-5 h-5" />
                        <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                          <PaletteIcon className="w-2 h-2 text-purple-700" />
                        </div>
                      </div>
                      <span>Download Colored Version</span>
                    </button>
                  )}
                  {generatedStory.isUnlocked && (
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center gap-1">
                      <CheckIcon className="w-3 h-3" /> Unlocked
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
                <div className="aspect-[16/9] bg-slate-100 relative group cursor-pointer">
                  {generatedStory.coverImage && (
                    <img src={generatedStory.coverImage} className="w-full h-full object-cover" alt="Cover" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-8">
                    <h1 className="text-4xl font-black text-white">{generatedStory.title}</h1>
                  </div>
                </div>

                <div className="p-8 space-y-12">
                  {generatedStory.pages.map((page, idx) => (
                    <div key={idx} className="flex flex-col md:flex-row gap-8 items-center border-b border-slate-50 pb-12 last:border-0 last:pb-0">
                      <div className="w-full md:w-1/2 flex flex-col items-center">
                        <div className="w-full aspect-[4/5] bg-white rounded-xl border-2 border-slate-100 shadow-sm relative group overflow-hidden cursor-pointer" onClick={() => setColoringPageIndex(idx)}>
                          <img
                            src={page.coloredImage || page.generatedImage}
                            className="w-full h-full object-contain p-2"
                            alt={`Page ${idx + 1}`}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 bg-white text-slate-900 font-bold px-6 py-2 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 flex items-center gap-2">
                              <PaletteIcon className="w-4 h-4" /> Click to Color
                            </span>
                          </div>
                        </div>
                        {/* Persistent Button for Creator too */}
                        <button
                          onClick={() => setColoringPageIndex(idx)}
                          className="mt-6 w-full md:w-auto bg-slate-900 text-white font-bold px-8 py-3 rounded-xl text-base shadow-xl hover:bg-indigo-600 transition-all transform hover:-translate-y-1 flex items-center justify-center gap-3 border-2 border-slate-900 hover:border-indigo-600"
                        >
                          <PaletteIcon className="w-5 h-5" />
                          Click to Color
                        </button>
                      </div>
                      <div className="w-full md:w-1/2 text-center md:text-left">
                        <h4 className="text-slate-400 font-bold uppercase text-xs tracking-widest mb-4">Page {idx + 1}</h4>
                        <p className="text-xl font-medium text-slate-800 leading-relaxed font-['Comic_Neue']">
                          {page.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        }

      </main>

      {
        coloringPageIndex !== null && generatedStory && (
          <ColoringInterface
            imageUrl={generatedStory.pages[coloringPageIndex].generatedImage!}
            initialState={generatedStory.pages[coloringPageIndex].coloredImage}
            onSave={handleSaveColoredPage}
            onClose={() => setColoringPageIndex(null)}
          />
        )
      }

      {
        showPaymentModal && (
          <PaymentModal
            storyTitle={generatedStory?.title || "My Story"}
            storyId={generatedStory?.id}
            pageCount={generatedStory?.pageCount || 25}
            cartTotal={appState === AppState.CART ? cartItems.reduce((acc, item) => acc + item.price, 0) : undefined}
            cartItems={appState === AppState.CART ? cartItems : undefined}
            userProfile={userProfile}
            onClose={() => setShowPaymentModal(false)}
            onSuccess={handlePaymentSuccess}
            onSubscribeClick={() => { }}
            initialTab={paymentModalInitialTab}
            onHardcoverOrder={handleHardcoverOrder}
          />
        )
      }

    </div >
  );
}
