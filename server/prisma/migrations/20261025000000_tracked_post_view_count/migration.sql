-- 25 Oct: Scrape public reel view/play counts from creator's reels tab
ALTER TABLE "TrackedPost" ADD COLUMN "viewCount" INTEGER;
