// Single source of truth for the hero roster.
// Used by server.js (validation) and scripts/generate-seo-content.js (SEO content).

const DOTA_HERO_NAMES = [
  "Abaddon", "Alchemist", "Ancient Apparition", "Anti-Mage", "Arc Warden",
  "Axe", "Bane", "Batrider", "Beastmaster", "Bloodseeker", "Bounty Hunter",
  "Brewmaster", "Bristleback", "Broodmother", "Centaur Warrunner",
  "Chaos Knight", "Chen", "Clinkz", "Clockwerk", "Crystal Maiden",
  "Dark Seer", "Dark Willow", "Dawnbreaker", "Dazzle", "Death Prophet",
  "Disruptor", "Doom", "Dragon Knight", "Drow Ranger", "Earth Spirit",
  "Earthshaker", "Elder Titan", "Ember Spirit", "Enchantress", "Enigma",
  "Faceless Void", "Grimstroke", "Gyrocopter", "Hoodwink", "Huskar",
  "Invoker", "Io", "Jakiro", "Juggernaut", "Keeper of the Light",
  "Kunkka", "Legion Commander", "Leshrac", "Lich", "Lifestealer", "Lina",
  "Lion", "Lone Druid", "Luna", "Lycan", "Magnus", "Marci", "Mars",
  "Medusa", "Meepo", "Mirana", "Monkey King", "Morphling", "Muerta",
  "Naga Siren", "Nature's Prophet", "Necrophos", "Night Stalker", "Nyx Assassin",
  "Ogre Magi", "Omniknight", "Oracle", "Outworld Destroyer", "Pangolier",
  "Phantom Assassin", "Phantom Lancer", "Phoenix", "Primal Beast", "Puck",
  "Pudge", "Pugna", "Queen of Pain", "Razor", "Riki", "Rubick",
  "Sand King", "Shadow Demon", "Shadow Fiend", "Shadow Shaman", "Silencer",
  "Skywrath Mage", "Slardar", "Slark", "Snapfire", "Sniper", "Spectre",
  "Spirit Breaker", "Storm Spirit", "Sven", "Techies", "Templar Assassin",
  "Terrorblade", "Tidehunter", "Timbersaw", "Tinker", "Tiny", "Treant Protector",
  "Troll Warlord", "Tusk", "Underlord", "Undying", "Ursa", "Vengeful Spirit",
  "Venomancer", "Viper", "Visage", "Void Spirit", "Warlock", "Weaver",
  "Windranger", "Winter Wyvern", "Witch Doctor", "Wraith King", "Zeus", "Ringmaster",
  "Kez"
].sort();

// Site-facing names that differ from dotaconstants' localized_name
const DOTACONSTANTS_ALIASES = {
  "Outworld Destroyer": "Outworld Devourer",
  "Ringmaster": "Ring Master"
};

// "Nature's Prophet" -> "natures-prophet", "Anti-Mage" -> "anti-mage"
function heroSlug(name) {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { DOTA_HERO_NAMES, DOTACONSTANTS_ALIASES, heroSlug };
