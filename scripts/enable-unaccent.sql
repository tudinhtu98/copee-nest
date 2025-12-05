-- Enable unaccent extension for Vietnamese search without diacritics
-- Run this manually if migration doesn't work: psql -d copee -f scripts/enable-unaccent.sql
CREATE EXTENSION IF NOT EXISTS unaccent;

