/**
 * Patterns to detect non-studio recordings
 *
 * Add or modify patterns here to customize what gets skipped.
 * All patterns are not case-sensitive.
 */

export const nonStudioPatterns = [
  // "Live" in specific contexts (not as part of song title)
  /[\(\[]live[\)\]]/i, // "(Live)" or "[Live]" in parentheses/brackets
  /live\s+(at|from|in|on|with|@)/i, // "Live at", "Live from", "Live in", etc.
  /live\s+with\b/i, // "Live with" (e.g. "Live with the SFSO")
  /-\s*live\s*$/i, // "- Live" at the end of title
  /:\s*live\s*$/i,                                // ": Live" at the end of title
  
  // Concert/Performance indicators
  /\b(concert|festival|tour)\b/i,                 // Concert, Festival, Tour
  /\(.*?(concert|live performance|live recording).*?(19|20)\d{2}\)/i, // (Live 1985), (Concert 2024)
  
  // Recording types
  /\b(acoustic|unplugged|rehearsal|demo)\b/i,     // Acoustic, Unplugged, Rehearsal, Demo
  
  // Venues
  /\b(arena|stadium|center|centre|hall)\b/i, // Arena, Stadium, Center, Hall
  /\bmadison\s+square\s+garden\b/i, // Madison Square Garden
  /day\s+on\s+the\s+green/i, // Day on the Green
  // Famous venues/festivals
  /\b(wembley|glastonbury|woodstock|coachella)\b/i, // Wembley, Glastonbury, Woodstock, Coachella
  // Dates and locations
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+/i, // "September 22", "August 31"
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, // Date formats: 09/22/2024, 9-22-24
  /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/,                 // Locations: "Oakland, CA", "London, UK"
  /\b[A-Z][a-z]+\s+City\b/i,                      // Cities: "Mexico City", "New York City"
  /\b(tokyo|paris|berlin|sydney)\b/i,             // More cities
  /\b(bbc|radio|session)\b/i,                      // Radio sessions
];

