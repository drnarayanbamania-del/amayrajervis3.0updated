import { verifyAdapterAgainstFixture } from "./adapterExecutor";
import type { ApiAdapterRegistry } from "./adapterRegistry";
import type { DeclarativeApiAdapter } from "./types";

const VERIFIED_AT = "2026-08-30T16:45:00.000Z";

export async function seedBuiltInAdapters(registry: ApiAdapterRegistry): Promise<void> {
  for (const adapter of builtInAdapters()) {
    if (!registry.get(adapter.id)) await registry.save(adapter);
  }
}

export function builtInAdapters(): DeclarativeApiAdapter[] {
  return [
    verifyAdapterAgainstFixture(
      candidate({
        id: "weather.open-meteo.current.v1",
        providerId: "public-apis:9062de724650ef9cb797",
        capability: "weather.current",
        method: "GET",
        urlTemplate: "https://api.open-meteo.com/v1/forecast",
        parameters: [
          { name: "latitude", in: "query", required: true },
          { name: "longitude", in: "query", required: true },
          { name: "current", in: "query", default: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m" },
          { name: "timezone", in: "query", default: "auto" },
          { name: "forecast_days", in: "query", default: 1 },
        ],
        output: {
          latitude: ".latitude",
          longitude: ".longitude",
          timezone: ".timezone",
          observedAt: ".current.time",
          temperatureC: ".current.temperature_2m",
          relativeHumidityPercent: ".current.relative_humidity_2m",
          weatherCode: ".current.weather_code",
          windSpeedKmh: ".current.wind_speed_10m",
        },
      }),
      {
        latitude: 18.52,
        longitude: 73.85,
        timezone: "Asia/Kolkata",
        current: {
          time: "2026-08-30T22:15",
          temperature_2m: 22.7,
          relative_humidity_2m: 90,
          weather_code: 2,
          wind_speed_10m: 13,
        },
      },
      "Built-in Open-Meteo schema and live endpoint validated on 2026-08-30.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "currency.frankfurter.rate.v2",
        providerId: "frankfurter:official-v2",
        capability: "currency.exchange_rate",
        method: "GET",
        urlTemplate: "https://api.frankfurter.dev/v2/rate/{base}/{quote}",
        parameters: [
          { name: "base", in: "path", required: true },
          { name: "quote", in: "path", required: true },
        ],
        output: {
          rateDate: ".date",
          baseCurrency: ".base",
          quoteCurrency: ".quote",
          rate: ".rate",
        },
      }),
      {
        date: "2026-08-30",
        base: "USD",
        quote: "INR",
        rate: 95.47,
      },
      "Official Frankfurter v2 single-pair schema and live USD/INR endpoint validated on 2026-08-30.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "space.launch-library.upcoming.v1",
        providerId: "public-apis:1945ae01a7dc12f7ef47",
        capability: "space.rocket_launch.upcoming",
        method: "GET",
        urlTemplate: "https://ll.thespacedevs.com/2.2.0/launch/upcoming/",
        parameters: [
          { name: "net__gt", in: "query", required: true },
          { name: "limit", in: "query", default: 5 },
          { name: "ordering", in: "query", default: "net" },
        ],
        output: {
          totalUpcoming: ".count",
          name: ".results[0].name",
          launchTime: ".results[0].net",
          status: ".results[0].status.name",
          provider: ".results[0].launch_service_provider.name",
          rocket: ".results[0].rocket.configuration.full_name",
          location: ".results[0].pad.location.name",
          mission: ".results[0].mission.name",
        },
      }),
      {
        count: 1,
        results: [{
          name: "Example launch",
          net: "2026-09-01T00:00:00Z",
          status: { name: "Go for Launch" },
          launch_service_provider: { name: "Example provider" },
          rocket: { configuration: { full_name: "Example rocket" } },
          pad: { location: { name: "Example location" } },
          mission: { name: "Example mission" },
        }],
      },
      "Built-in Launch Library 2 schema, ordering, and future-time filter validated on 2026-08-30.",
    ),
    // -----------------------------------------------------------------------
    // Public-apis skill pack (2026-09-07): twelve additional no-auth APIs from
    // the github.com/public-apis/public-apis catalogue, each verified against a
    // live-response fixture captured the same day.
    // -----------------------------------------------------------------------
    verifyAdapterAgainstFixture(
      candidate({
        id: "knowledge.wikipedia.summary.v1",
        providerId: "public-apis:872a19b42b5cd86d89dd",
        capability: "knowledge.wikipedia.summary",
        method: "GET",
        urlTemplate: "https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
        parameters: [{ name: "title", in: "path", required: true }],
        output: {
          title: ".title",
          extract: ".extract",
          pageUrl: ".content_urls.desktop.page",
          wikibaseId: ".wikibase_item",
        },
      }),
      {
        type: "standard",
        title: "India",
        extract: "India, officially the Republic of India, is a country in South Asia.",
        wikibase_item: "Q668",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/India" } },
      },
      "Wikipedia REST summary endpoint live-validated on 2026-09-07.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "code.github.user.lookup.v1",
        providerId: "public-apis:96826c01f378df109ca8",
        capability: "code.github.user.lookup",
        method: "GET",
        urlTemplate: "https://api.github.com/users/{username}",
        parameters: [{ name: "username", in: "path", required: true }],
        output: {
          login: ".login",
          name: ".name",
          bio: ".bio",
          publicRepos: ".public_repos",
          followers: ".followers",
          profileUrl: ".html_url",
        },
      }),
      {
        login: "torvalds",
        name: "Linus Torvalds",
        bio: null,
        public_repos: 8,
        followers: 190000,
        html_url: "https://github.com/torvalds",
      },
      "GitHub public user endpoint live-validated on 2026-09-07 (unauthenticated, 60 req/h per IP).",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "crypto.coingecko.price.v1",
        providerId: "public-apis:1b2531064282e61ce6ac",
        capability: "crypto.price.spot",
        method: "GET",
        urlTemplate: "https://api.coingecko.com/api/v3/simple/price",
        parameters: [
          { name: "ids", in: "query", required: true, default: "bitcoin" },
          { name: "vs_currencies", in: "query", required: true, default: "inr" },
          { name: "include_24hr_change", in: "query", default: true },
        ],
        output: {
          bitcoinPrice: ".bitcoin.inr",
          bitcoinChange24hPct: ".bitcoin.inr_24h_change",
        },
      }),
      {
        bitcoin: { inr: 7523926, inr_24h_change: -0.32454939713910796 },
      },
      "CoinGecko simple-price live-validated on 2026-09-07. Mappings cover the bitcoin/INR default; other ids return untyped payloads.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "fun.dog.image.random.v1",
        providerId: "public-apis:79384d693553d9c2774e",
        capability: "fun.dog.image.random",
        method: "GET",
        urlTemplate: "https://dog.ceo/api/breeds/image/random",
        parameters: [],
        output: {
          imageUrl: ".message",
          status: ".status",
        },
      }),
      {
        message: "https://images.dog.ceo/breeds/greyhound-italian/n02091032_1360.jpg",
        status: "success",
      },
      "Dog CEO random-image endpoint live-validated on 2026-09-07.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "fun.joke.random.v1",
        providerId: "official-joke-api:appspot-v1",
        capability: "fun.joke.random",
        method: "GET",
        urlTemplate: "https://official-joke-api.appspot.com/random_joke",
        parameters: [],
        output: {
          type: ".type",
          setup: ".setup",
          punchline: ".punchline",
        },
      }),
      {
        type: "general",
        setup: "Can February march?",
        punchline: "No, but April may.",
        id: 81,
      },
      "Official Joke API random endpoint live-validated on 2026-09-07.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "wisdom.quote.random.v1",
        providerId: "public-apis:201362463e230885e7c6",
        capability: "wisdom.quote.random",
        method: "GET",
        urlTemplate: "https://zenquotes.io/api/random",
        parameters: [],
        output: {
          quote: "$[0].q",
          author: "$[0].a",
        },
      }),
      [
        {
          q: "It's wise to tell the truth. It's even wiser to tell it kindly.",
          a: "Maxime Lagace",
          h: "<blockquote>&ldquo;It&#039;s wise to tell the truth.&rdquo;</blockquote>",
        },
      ],
      "ZenQuotes random endpoint live-validated on 2026-09-07 (top-level array fixture).",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "space.nasa.apod.v1",
        providerId: "public-apis:6db62fa4793cacb25533",
        capability: "space.astronomy_picture_of_day",
        method: "GET",
        urlTemplate: "https://api.nasa.gov/planetary/apod",
        parameters: [
          { name: "api_key", in: "query", default: "DEMO_KEY" },
          { name: "date", in: "query" },
        ],
        output: {
          title: ".title",
          explanation: ".explanation",
          date: ".date",
          mediaUrl: ".url",
          mediaType: ".media_type",
        },
      }),
      {
        copyright: "Mark Killion",
        date: "2026-09-07",
        explanation: "The Pelican Nebula is slowly being transformed.",
        media_type: "image",
        title: "The Pelican Nebula",
        url: "https://apod.nasa.gov/apod/image/2609/example.jpg",
      },
      "NASA APOD live-validated on 2026-09-07 with the DEMO_KEY default (30 req/h per IP).",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "food.recipe.search.v1",
        providerId: "public-apis:728aab4dcd957acda1fb",
        capability: "food.recipe.search",
        method: "GET",
        urlTemplate: "https://www.themealdb.com/api/json/v1/1/search.php",
        parameters: [{ name: "s", in: "query", required: true }],
        output: {
          name: ".meals[0].strMeal",
          category: ".meals[0].strCategory",
          cuisine: ".meals[0].strArea",
          instructions: ".meals[0].strInstructions",
          videoUrl: ".meals[0].strYoutube",
        },
      }),
      {
        meals: [{
          idMeal: "52805",
          strMeal: "Lamb Biryani",
          strCategory: "Lamb",
          strArea: "India",
          strInstructions: "Grind the cashew, poppy seeds and cumin seeds into a smooth paste.",
          strYoutube: "https://www.youtube.com/watch?v=EXAMPLE",
        }],
      },
      "TheMealDB search-by-name live-validated on 2026-09-07 (free test key embedded in path).",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "network.ip.location.v1",
        providerId: "public-apis:6cec605157bbb3b084ca",
        capability: "network.ip.location",
        method: "GET",
        urlTemplate: "https://ipapi.co/json/",
        parameters: [],
        output: {
          ip: ".ip",
          city: ".city",
          region: ".region",
          country: ".country_name",
          latitude: ".latitude",
          longitude: ".longitude",
          timezone: ".timezone",
        },
      }),
      {
        ip: "2405:201:3020:a373:a1d9:de3a:73b8:d573",
        city: "Jabalpur",
        region: "Madhya Pradesh",
        country_name: "India",
        latitude: 23.16,
        longitude: 79.93,
        timezone: "Asia/Kolkata",
      },
      "ipapi.co self-geolocation live-validated on 2026-09-07 (1000 req/day free tier).",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "wisdom.advice.random.v1",
        providerId: "public-apis:01cb837742610ece9f2b",
        capability: "wisdom.advice.random",
        method: "GET",
        urlTemplate: "https://api.adviceslip.com/advice",
        parameters: [],
        output: {
          id: ".slip.id",
          advice: ".slip.advice",
        },
      }),
      {
        slip: { id: 170, advice: "Remedy tickly coughs with a drink of honey, lemon and water as hot as you can take." },
      },
      "Advice Slip random endpoint live-validated on 2026-09-07.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "dev.jsonplaceholder.post.v1",
        providerId: "public-apis:71d06732be3e7a3a1433",
        capability: "dev.fake_rest.post",
        method: "GET",
        urlTemplate: "https://jsonplaceholder.typicode.com/posts/{id}",
        parameters: [{ name: "id", in: "path", required: true, default: 1 }],
        output: {
          userId: ".userId",
          id: ".id",
          title: ".title",
          body: ".body",
        },
      }),
      {
        userId: 1,
        id: 1,
        title: "sunt aut facere repellat provident occaecati excepturi optio reprehenderit",
        body: "quia et suscipit",
      },
      "JSONPlaceholder post fetch live-validated on 2026-09-07.",
    ),
    verifyAdapterAgainstFixture(
      candidate({
        id: "news.hackernews.search.v1",
        providerId: "public-apis:a29c5ae8802a6109a0a3",
        capability: "news.hackernews.search",
        method: "GET",
        urlTemplate: "https://hn.algolia.com/api/v1/search",
        parameters: [
          { name: "query", in: "query", required: true },
          { name: "tags", in: "query", default: "story" },
          { name: "hitsPerPage", in: "query", default: 1 },
        ],
        output: {
          totalHits: ".nbHits",
          title: ".hits[0].title",
          url: ".hits[0].url",
          points: ".hits[0].points",
          author: ".hits[0].author",
          postedAt: ".hits[0].created_at",
        },
      }),
      {
        nbHits: 812,
        hits: [{
          title: "Ask HN: How to self-learn electron?",
          url: "https://news.ycombinator.com/item?id=1",
          points: 42,
          author: "sidyapa",
          created_at: "2026-09-01T10:00:00Z",
        }],
      },
      "Hacker News Algolia search live-validated on 2026-09-07.",
    ),
  ];
}

function candidate(
  input: Pick<DeclarativeApiAdapter, "id" | "providerId" | "capability" | "method" | "urlTemplate" | "parameters" | "output">,
): DeclarativeApiAdapter {
  return {
    ...input,
    verified: false,
    verifiedAt: null,
    verificationNotes: null,
    createdAt: VERIFIED_AT,
    updatedAt: VERIFIED_AT,
  };
}
