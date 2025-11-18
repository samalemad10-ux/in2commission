-- Add revenue multiplier brackets for each department
ALTER TABLE commission_settings 
ADD COLUMN ae_revenue_multiplier_brackets jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN sdr_revenue_multiplier_brackets jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN marketing_revenue_multiplier_brackets jsonb NOT NULL DEFAULT '[]'::jsonb;