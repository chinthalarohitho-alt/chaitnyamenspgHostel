export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://tymigiyvevbxrjdalbls.supabase.co';
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5bWlnaXl2ZXZieHJqZGFsYmxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzODQ0NDksImV4cCI6MjEwNDk2MDQ0OX0.iMZRFJspn6nfl2JZuKkJjJNTlBLziADUDknVYfN0DRw';

    const resp = await fetch(`${supabaseUrl}/rest/v1/site_config?select=id`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });

    if (!resp.ok) {
      return res.status(500).json({ ok: false, error: 'Supabase ping failed' });
    }

    const data = await resp.json();
    return res.status(200).json({
      ok: true,
      message: 'Supabase database is active and awake!',
      records: data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
