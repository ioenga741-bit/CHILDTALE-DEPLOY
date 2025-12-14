
-- ==========================================
-- CHILDTALE SECURE SUPABASE SETUP
-- (Idempotent: Safe to run multiple times)
-- ==========================================

-- 1. BOOKS TABLE SECURITY
-- ------------------------------------------
ALTER TABLE books ENABLE ROW LEVEL SECURITY;

-- VIEW: Public (Anyone with the link/UUID can see the book)
DROP POLICY IF EXISTS "Public Read Access" ON books;
CREATE POLICY "Public Read Access"
ON books FOR SELECT
TO anon, authenticated
USING (true);

-- INSERT: Authenticated Only (No anonymous bots creating books)
DROP POLICY IF EXISTS "Authenticated Create Access" ON books;
CREATE POLICY "Authenticated Create Access"
ON books FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- UDPATE: Authenticated Only (Must be logged in to save/color)
-- Note: Requires 'user_id' check to be strictly "Owner Only", 
-- but we leave it open to 'authenticated' for now to allow Collaboration 
-- if they have the UUID.
DROP POLICY IF EXISTS "Authenticated Update Access" ON books;
DROP POLICY IF EXISTS "Public Update Access" ON books; -- Cleanup old policy
CREATE POLICY "Authenticated Update Access"
ON books FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- DELETE: Owner Only (Strict!)
-- Only the actual creator can delete the book.
DROP POLICY IF EXISTS "Owner Delete Access" ON books;
CREATE POLICY "Owner Delete Access"
ON books FOR DELETE
TO authenticated
USING (auth.uid() = user_id);


-- 2. STORAGE BUCKET SETUP
-- ------------------------------------------

-- Create 'images' bucket (Idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies

-- VIEW: Public (Images serve to the frontend)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'images' );

-- UPLOAD: Authenticated Only
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;
CREATE POLICY "Authenticated Uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'images' );

-- UPDATE: Authenticated Only
DROP POLICY IF EXISTS "Authenticated Updates" ON storage.objects;
CREATE POLICY "Authenticated Updates"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'images' );

-- 3. LULU POD INTEGRATION
-- ------------------------------------------

-- Orders tracking table
CREATE TABLE IF NOT EXISTS lulu_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  lulu_order_id TEXT NOT NULL,
  lulu_job_id TEXT,
  status TEXT DEFAULT 'pending',
  tracking_number TEXT,
  cover_pdf_url TEXT,
  interior_pdf_url TEXT,
  shipping_address JSONB,
  total_cost NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lulu_orders_user ON lulu_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_lulu_orders_book ON lulu_orders(book_id);
CREATE INDEX IF NOT EXISTS idx_lulu_orders_status ON lulu_orders(status);

-- Row Level Security for orders
ALTER TABLE lulu_orders ENABLE ROW LEVEL SECURITY;

-- Users can view their own orders
DROP POLICY IF EXISTS "Users View Own Orders" ON lulu_orders;
CREATE POLICY "Users View Own Orders"
ON lulu_orders FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can create orders
DROP POLICY IF EXISTS "Users Create Orders" ON lulu_orders;
CREATE POLICY "Users Create Orders"
ON lulu_orders FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- PDF Storage bucket (for Lulu access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lulu-pdfs', 'lulu-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for PDFs

-- PUBLIC READ: Lulu needs to access these
DROP POLICY IF EXISTS "Public PDF Access" ON storage.objects;
CREATE POLICY "Public PDF Access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'lulu-pdfs');

-- Authenticated users can upload their PDFs
DROP POLICY IF EXISTS "Users Upload PDFs" ON storage.objects;
CREATE POLICY "Users Upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lulu-pdfs' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can update their own PDFs
DROP POLICY IF EXISTS "Users Update PDFs" ON storage.objects;
CREATE POLICY "Users Update PDFs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'lulu-pdfs' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
