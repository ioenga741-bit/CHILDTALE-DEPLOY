# ChildTale: Cart & Regeneration Features Implementation

## 📋 Overview

This implementation adds two major features to ChildTale:
1. **Shopping Cart** - Allows users to save multiple book drafts before checkout
2. **Regeneration Credits** - Provides free regeneration attempts when book generation fails

---

## 🗄️ Database Changes

### SQL Migration Script
Location: `database/migrations/add_cart_and_regeneration_features.sql`

**Run this SQL script in your Supabase SQL Editor to apply all database changes.**

### Key Changes:
1. **profiles table**: Added `regeneration_credits` column
2. **books table**: Added `generation_attempts` and `last_generation_attempt` columns
3. **cart table**: Added `expires_at` column (7-day expiration)
4. **Database Functions**:
   - `handle_generation_failure()` - Grants regeneration credit when generation fails
   - `consume_regeneration_credit()` - Uses credit to retry generation
   - `expire_old_cart_items()` - Cleans up expired cart items
5. **View**: `user_library_view` - Organizes books by status for library display

---

## 🛠️ Code Changes

### 1. Updated Types (`types.ts`)
- Added `BookStatus` type: `'draft' | 'purchased' | 'generating' | 'completed' | 'failed'`
- Added `LibraryCategory` type for organizing books
- Enhanced `Story` interface with generation tracking fields
- Added `regenerationCredits` to `UserProfile`
- Updated `CartItem` interface with new fields

### 2. New Service Layer (`services/cartAndRegenerationService.ts`)

#### CartService
```typescript
// Add book to cart
await CartService.addToCart({
  bookId: 'uuid',
  formatType: 'digital', // or 'hardcover'
  price: 24.99
});

// Get all cart items
const items = await CartService.getCartItems();

// Remove from cart
await CartService.removeFromCart(cartItemId);

// Clear entire cart
await CartService.clearCart();

// Get cart total
const total = await CartService.getCartTotal();
```

#### RegenerationService
```typescript
// Check if book has regeneration credit
const hasCredit = await RegenerationService.hasRegenerationCredit(bookId);

// Regenerate a failed book
const result = await RegenerationService.regenerateBook(bookId);

// Handle generation failure (call this when generation fails)
await RegenerationService.handleGenerationFailure(bookId, errorMessage);

// Get user's regeneration credits count
const credits = await RegenerationService.getRegenerationCredits();
```

#### LibraryService
```typescript
// Get books organized by category
const library = await LibraryService.getLibraryBooks();
// Returns: {
//   completed: [],
//   generating: [],
//   failedWithCredit: [],
//   unpaidDrafts: [],
//   pendingGeneration: []
// }
```

### 3. New Library Component (`components/LibraryPage.tsx`)

Features:
- ✅ Filter tabs (All, Completed, Generating, Failed, Drafts)
- ✅ Status badges for each book
- ✅ Regeneration credit display
- ✅ "Regenerate" button for failed books
- ✅ Different actions based on book status

### 4. New Icons Added (`components/Icons.tsx`)
- `ClockIcon` - For generating status
- `AlertCircleIcon` - For failed status
- `CheckCircleIcon` - For completed status

---

## 🔄 User Flows

### Cart Flow
```
1. User creates book draft (status='draft')
2. User clicks "Add to Cart" → Book added to cart table
3. User creates more books and adds to cart
4. User goes to Cart page → Reviews all items
5. User clicks "Checkout" → Stripe payment
6. After payment → Books marked as purchased, generation starts
```

### Regeneration Flow
```
1. User pays for book
2. Generation starts (status='generating')
3. Generation FAILS (API error, timeout, etc.)
   ↓
4. System calls handleGenerationFailure()
   - Book status → 'failed'
   - Order credit_status → 'active'
   - User regeneration_credits +1
   ↓
5. Book appears in Library "Failed" section
6. User clicks "Regenerate" button
   ↓
7. System calls consumeRegenerationCredit()
   - Checks if credit available
   - Decrements regeneration_credits
   - Marks order credit_status → 'used'
   - Starts generation again
   ↓
8. If SUCCESS → Book moves to "Completed"
   If FAILS → Credit stays active, user can retry again
```

---

## 📚 Library Organization

Books are automatically categorized:

| Category | Description | Actions Available |
|----------|-------------|-------------------|
| **Completed** | Successfully generated books | View, Color, Download |
| **Generating** | Currently being created | Show progress |
| **Failed with Credit** | Failed but has regen credit | Regenerate (Free) |
| **Unpaid Drafts** | Created but not paid | Complete Purchase |
| **Pending Generation** | Paid but not started | Show waiting status |

---

## 🎯 Integration Points

### In Your Book Creation Flow:

```typescript
// When user clicks "Add to Cart" instead of "Buy Now"
const result = await CartService.addToCart({
  bookId: newBook.id,
  formatType: selectedFormat, // 'digital' or 'hardcover'
  price: selectedFormat === 'digital' ? 24.99 : 49.99
});

if (result.success) {
  alert('Added to cart!');
  // Redirect to cart or show cart icon with count
}
```

### In Your Generation Error Handler:

```typescript
try {
  // Your generation logic
  await generateBook(bookId);
  
  // On success
  await LibraryService.updateBookStatus(bookId, 'completed');
  
} catch (error) {
  // On failure - Grant regeneration credit
  await RegenerationService.handleGenerationFailure(
    bookId,
    error.message
  );
}
```

### In Your Stripe Checkout Success Handler:

```typescript
// After successful payment
const cartItems = await CartService.getCartItems();

for (const item of cartItems) {
  // Mark book as purchased
  await supabase
    .from('books')
    .update({ 
      is_purchased: true,
      status: 'purchased' // or 'generating' if starting immediately
    })
    .eq('id', item.bookId);
  
  // Start generation
  await startBookGeneration(item.bookId);
}

// Clear cart after successful checkout
await CartService.clearCart();
```

---

## 🚀 Next Steps

### 1. Run the SQL Migration
```sql
-- In Supabase SQL Editor, run:
database/migrations/add_cart_and_regeneration_features.sql
```

### 2. Update Your App.tsx
- Import `LibraryPage` component
- Add routing for Library with filters
- Integrate `CartService` in book creation flow
- Add "Add to Cart" button alongside "Buy Now"

### 3. Update Your Generation Logic
- Wrap generation in try/catch
- Call `handleGenerationFailure()` on errors
- Update book status to 'generating' when starting
- Update to 'completed' on success

### 4. Update Your Cart Page
- Use `CartService.getCartItems()` to display items
- Show total with `CartService.getCartTotal()`
- Implement remove functionality
- Add checkout button that processes all items

### 5. Test the Flow
1. Create a book draft
2. Add to cart
3. Create another draft
4. Add to cart
5. Go to cart and checkout
6. Simulate a generation failure
7. Check library for failed book
8. Click regenerate

---

## 💡 Tips & Best Practices

1. **Cart Expiration**: Cart items expire after 7 days. Run `expire_old_cart_items()` periodically (e.g., daily cron job)

2. **Max Retries**: Orders have `max_retries` (default 3). After 3 failed attempts, consider offering refund or manual support

3. **Credit Expiration**: Credits expire after 90 days (`orders.expires_at`). Check this before allowing regeneration

4. **Status Updates**: Always update book status when:
   - Starting generation: `'generating'`
   - Success: `'completed'`
   - Failure: `'failed'`

5. **Error Handling**: Always wrap service calls in try/catch and show user-friendly error messages

---

## 🐛 Troubleshooting

### "No regeneration credit available"
- Check if order has `credit_status='active'`
- Check if user has `regeneration_credits > 0`
- Verify order hasn't expired (`expires_at`)

### Cart items not showing
- Check if items have expired (`expires_at < NOW()`)
- Verify user is authenticated
- Check if books still exist in database

### Regeneration not working
- Ensure SQL functions are created correctly
- Check Supabase logs for RPC errors
- Verify book has associated order with `payment_status='succeeded'`

---

## 📊 Monitoring

Track these metrics:
- Cart abandonment rate
- Average items per cart
- Regeneration credit usage
- Generation failure rate
- Time to successful generation after failure

---

## 🎨 UI Recommendations

### Cart Badge
Show cart count in navigation:
```typescript
const [cartCount, setCartCount] = useState(0);

useEffect(() => {
  const loadCartCount = async () => {
    const count = await CartService.getCartCount();
    setCartCount(count);
  };
  loadCartCount();
}, []);
```

### Regeneration Credit Badge
Show in user profile or library header:
```typescript
const [credits, setCredits] = useState(0);

useEffect(() => {
  const loadCredits = async () => {
    const count = await RegenerationService.getRegenerationCredits();
    setCredits(count);
  };
  loadCredits();
}, []);
```

---

## ✅ Checklist

- [ ] Run SQL migration in Supabase
- [ ] Test cart add/remove/clear functions
- [ ] Test regeneration credit flow
- [ ] Update book creation UI with "Add to Cart" button
- [ ] Update generation error handling
- [ ] Test library filtering
- [ ] Add cart count badge to navigation
- [ ] Add regeneration credit display
- [ ] Test complete user flow end-to-end
- [ ] Set up cart expiration cron job
- [ ] Monitor generation failure rates

---

## 📞 Support

If you encounter any issues:
1. Check Supabase logs for errors
2. Verify SQL functions are created
3. Check browser console for client-side errors
4. Review this README for integration points

---

**Implementation Complete! 🎉**

Your ChildTale platform now has robust cart functionality and a fair regeneration credit system that builds user trust and prevents frustration from failed generations.
