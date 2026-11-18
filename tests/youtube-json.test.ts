import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { filterYouTubeJson } from "../src/adapters/youtube-json.js";
import type { FeedItem } from "../src/types.js";

describe("filterYouTubeJson", () => {
  it("strips Shorts shelves, splices dropped videos, and calms/mid-frames kept videos", async () => {
    const browsePayload = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  richGridRenderer: {
                    contents: [
                      {
                        richSectionRenderer: {
                          content: {
                            richShelfRenderer: {
                              contents: [
                                {
                                  richItemRenderer: {
                                    content: {
                                      shortsLockupViewModel: {
                                        onTap: {
                                          innertubeCommand: {
                                            reelWatchEndpoint: { videoId: "short111111" },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                      {
                        richItemRenderer: {
                          content: {
                            lockupViewModel: {
                              contentId: "goodVid1234",
                              metadata: {
                                lockupMetadataViewModel: {
                                  title: { content: "BUILDING A TINY FPGA OSCILLOSCOPE!!" },
                                  metadata: {
                                    contentMetadataViewModel: {
                                      metadataRows: [
                                        { metadataParts: [{ text: { content: "LabNotes" } }] },
                                      ],
                                    },
                                  },
                                },
                              },
                              contentImage: {
                                thumbnailViewModel: {
                                  image: {
                                    sources: [
                                      {
                                        url: "https://i.ytimg.com/vi/goodVid1234/maxresdefault.jpg",
                                      },
                                    ],
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        richItemRenderer: {
                          content: {
                            videoRenderer: {
                              videoId: "slopVid9999",
                              title: { runs: [{ text: "Celebrity Drama Recap" }] },
                              shortBylineText: {
                                runs: [
                                  {
                                    text: "Drama Mill",
                                    navigationEndpoint: {
                                      browseEndpoint: { browseId: "UCdrama999" },
                                    },
                                  },
                                ],
                              },
                              thumbnail: {
                                thumbnails: [
                                  { url: "https://i.ytimg.com/vi/slopVid9999/hqdefault.jpg" },
                                ],
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };

    const filtered = (await filterYouTubeJson(
      browsePayload,
      "/youtubei/v1/browse",
      "https://www.youtube.com/",
      DEFAULT_CONFIG,
      async (items) => {
        expect(items.map((i) => i.id)).toEqual(["goodVid1234", "slopVid9999"]);
        return new Set(["slopVid9999"]);
      },
    )) as typeof browsePayload;

    const gridItems =
      filtered.contents.twoColumnBrowseResultsRenderer.tabs[0]!.tabRenderer.content.richGridRenderer
        .contents;

    expect(gridItems).toHaveLength(1);
    const kept = gridItems[0]!.richItemRenderer!.content.lockupViewModel!;
    expect(kept.metadata.lockupMetadataViewModel.title.content).toBe(
      "Building a tiny FPGA oscilloscope!",
    );
    expect(kept.contentImage.thumbnailViewModel.image.sources[0]!.url).toBe(
      "https://i.ytimg.com/vi/goodVid1234/hq2.jpg",
    );
  });

  it("extracts @handle, UC browseId, duration, and views context from modern lockupViewModel cards", async () => {
    const payload = {
      contents: [
        {
          richItemRenderer: {
            content: {
              lockupViewModel: {
                contentId: "lockupVid01",
                metadata: {
                  lockupMetadataViewModel: {
                    title: { content: "Custom Silicon at Home" },
                    image: {
                      decoratedAvatarViewModel: {
                        rendererContext: {
                          commandContext: {
                            onTap: {
                              innertubeCommand: {
                                browseEndpoint: {
                                  browseId: "UC_sam_zeno",
                                  canonicalBaseUrl: "/@SamZeloof",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    metadata: {
                      contentMetadataViewModel: {
                        metadataRows: [
                          { metadataParts: [{ text: { content: "Sam Zeloof" } }] },
                          {
                            metadataParts: [
                              { text: { content: "180K views" } },
                              { text: { content: "5 hours ago" } },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
                contentImage: {
                  thumbnailViewModel: {
                    overlays: [
                      {
                        thumbnailOverlayBadgeViewModel: {
                          thumbnailBadges: [
                            { thumbnailBadgeViewModel: { text: "24:15" } },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      ],
    };

    let extracted: FeedItem | undefined;
    await filterYouTubeJson(payload, "/youtubei/v1/browse", "https://www.youtube.com/", DEFAULT_CONFIG, async (items) => {
      extracted = items[0];
      return new Set();
    });

    expect(extracted).toMatchObject({
      id: "lockupVid01",
      creatorId: "UC_sam_zeno",
      creatorHandle: "@SamZeloof",
      durationSec: 1455,
      secondaryText: "Sam Zeloof · 180K views · 5 hours ago",
    });
  });

  it("leaves /feed/subscriptions videos unfiltered while still removing Shorts shelves", async () => {
    const subsPayload = {
      contents: {
        items: [
          { reelShelfRenderer: { title: "Shorts" } },
          {
            videoRenderer: {
              videoId: "subVid00001",
              title: { simpleText: "Weekly Vlog" },
            },
          },
        ],
      },
    };
    let deciderCalled = false;
    const out = (await filterYouTubeJson(
      subsPayload,
      "/youtubei/v1/browse",
      "https://www.youtube.com/feed/subscriptions",
      DEFAULT_CONFIG,
      async () => {
        deciderCalled = true;
        return new Set(["subVid00001"]);
      },
    )) as typeof subsPayload;

    expect(deciderCalled).toBe(false);
    expect(out.contents.items).toHaveLength(1);
  });

  it("never drops videos on YouTube channel profiles (even during SPA transitions from /) while still de-hyping titles and thumbnails", async () => {
    const channelPayload = {
      metadata: {
        channelMetadataRenderer: { title: "Some Creator", externalId: "UC_profile_1" },
      },
      contents: {
        items: [
          {
            videoRenderer: {
              videoId: "profVid0001",
              title: { simpleText: "MY CRAZIEST PCB BUILD YET!!" },
              thumbnail: {
                thumbnails: [{ url: "https://i.ytimg.com/vi/profVid0001/maxresdefault.jpg" }],
              },
            },
          },
        ],
      },
    };

    let deciderCalled = false;
    const out = (await filterYouTubeJson(
      channelPayload,
      "/youtubei/v1/browse",
      "https://www.youtube.com/",
      DEFAULT_CONFIG,
      async () => {
        deciderCalled = true;
        return new Set(["profVid0001"]);
      },
    )) as typeof channelPayload;

    expect(deciderCalled).toBe(false);
    expect(out.contents.items).toHaveLength(1);
    expect(out.contents.items[0]!.videoRenderer.title.simpleText).toBe(
      "My craziest PCB build yet!",
    );
    expect(out.contents.items[0]!.videoRenderer.thumbnail.thumbnails[0]!.url).toBe(
      "https://i.ytimg.com/vi/profVid0001/hq2.jpg",
    );
  });
});

describe("filterYouTubeJson continuation", () => {
  it("keeps the continuationItemRenderer when every video is dropped", async () => {
    const payload = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              { videoRenderer: { videoId: "dropVid0001", title: { simpleText: "Ragebait one" } } },
              { videoRenderer: { videoId: "dropVid0002", title: { simpleText: "Ragebait two" } } },
              { continuationItemRenderer: { continuationEndpoint: { token: "next" } } },
            ],
          },
        },
      ],
    };
    const out = (await filterYouTubeJson(
      payload,
      "/youtubei/v1/browse",
      "https://www.youtube.com/",
      DEFAULT_CONFIG,
      async () => new Set(["dropVid0001", "dropVid0002"]),
    )) as typeof payload;
    expect(out.onResponseReceivedActions[0]!.appendContinuationItemsAction.continuationItems).toEqual([
      { continuationItemRenderer: { continuationEndpoint: { token: "next" } } },
    ]);
  });
});
