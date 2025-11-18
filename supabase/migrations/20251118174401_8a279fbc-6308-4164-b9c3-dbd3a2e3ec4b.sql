-- Create commission_settings table (single row configuration)
CREATE TABLE public.commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ae_brackets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ae_payment_term_bonuses JSONB NOT NULL DEFAULT '[]'::jsonb,
  sdr_meeting_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  sdr_closed_won_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  marketing_same_as_sdr BOOLEAN NOT NULL DEFAULT true,
  marketing_inbound_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create commission_run_logs table
CREATE TABLE public.commission_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  rep_id TEXT NOT NULL,
  rep_name TEXT NOT NULL,
  team TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  commission_json JSONB NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_run_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all authenticated users for now - can be restricted to admin role later)
CREATE POLICY "Allow authenticated users to view commission settings"
  ON public.commission_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to update commission settings"
  ON public.commission_settings FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert commission settings"
  ON public.commission_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view commission run logs"
  ON public.commission_run_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert commission run logs"
  ON public.commission_run_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Insert default settings row
INSERT INTO public.commission_settings (
  ae_brackets,
  ae_payment_term_bonuses,
  sdr_meeting_tiers,
  sdr_closed_won_percent,
  marketing_same_as_sdr,
  marketing_inbound_percent
) VALUES (
  '[
    {"min": 0, "max": 50000, "percent": 5},
    {"min": 50000, "max": 100000, "percent": 7.5},
    {"min": 100000, "max": null, "percent": 10}
  ]'::jsonb,
  '[
    {"term": "3 months", "bonus_percent": 1},
    {"term": "6 months", "bonus_percent": 2},
    {"term": "12 months", "bonus_percent": 3}
  ]'::jsonb,
  '[
    {"min": 0, "max": 5, "bonus_amount": 50},
    {"min": 5, "max": 10, "bonus_amount": 100},
    {"min": 10, "max": null, "bonus_amount": 150}
  ]'::jsonb,
  5.0,
  true,
  3.0
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_commission_settings_updated_at
  BEFORE UPDATE ON public.commission_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better query performance
CREATE INDEX idx_commission_run_logs_rep_id ON public.commission_run_logs(rep_id);
CREATE INDEX idx_commission_run_logs_run_date ON public.commission_run_logs(run_date DESC);
CREATE INDEX idx_commission_run_logs_period ON public.commission_run_logs(period_start, period_end);