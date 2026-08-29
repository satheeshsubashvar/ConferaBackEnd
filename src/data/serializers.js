// Maps real-schema Postgres rows (PascalCase, split across Event +
// AppBrandings + EventParticipant + SponsorProfile) to the flat
// camelCase JSON shape the frontend already expects, so no frontend
// component needs to change even though the backing schema is now
// the full 32-migration multi-tenant design instead of a simplified
// single-table Event model.

function toDateStr(value) {
  if (!value) return null;
  // db.js overrides pg's timestamp parser (OID 1114) to return raw
  // strings like "2026-10-01T00:00:00" instead of JS Date objects,
  // specifically to avoid timezone-dependent date shifting. Slicing
  // the string directly here preserves that — never construct a
  // Date from this value for calendar-date purposes.
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function toTimeStr(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// `branding` is optional — the caller passes the joined AppBrandings
// row (or null) since it lives in a separate table from Event.
export function serializeEvent(eventRow, brandingRow = null) {
  if (!eventRow) return null;
  return {
    id: eventRow.EventId,
    organizationId: eventRow.OrganizationId,
    name: eventRow.Title,
    shortCode: eventRow.EventCode,
    shortDescription: eventRow.ShortDescription || '',
    slug: eventRow.Slug,
    status: eventRow.Status,
    startDate: toDateStr(eventRow.StartDate),
    endDate: toDateStr(eventRow.EndDate),
    startTime: toTimeStr(eventRow.StartDate),
    endTime: toTimeStr(eventRow.EndDate),
    timeZone: eventRow.TimeZone || 'UTC',
    numberOfAttendees: eventRow.MaxAttendees,
    venueName: eventRow.VenueName,
    venueAddress: eventRow.VenueAddress,
    streetAddress: '', // no direct equivalent in the real schema; VenueAddress covers this
    city: eventRow.VenueCity,
    state: eventRow.VenueState || '',
    postalCode: eventRow.VenuePostalCode || '',
    country: eventRow.VenueCountry,
    website: eventRow.WebsiteUrl,
    description: eventRow.Description,
    welcomeMessage: eventRow.WelcomeMessage || '',
    twitterHashtag: eventRow.TwitterHashtag || '',
    eventTypeId: eventRow.EventTypeId || '',
    brandColorFrom: brandingRow?.PrimaryColor || '#7c3aed',
    brandColorTo: brandingRow?.SecondaryColor || '#4c1d95',
    logoUrl: brandingRow?.LogoUrl || eventRow.LogoUrl || '',
    heroImageUrl: eventRow.BannerImageUrl || '',
    tagline: brandingRow?.TagLine || '',
    createdAt: eventRow.CreatedAt,
    updatedAt: eventRow.UpdatedAt,
  };
}

export function serializeEventType(row) {
  return {
    id: row.EventTypeId,
    name: row.Name,
    description: row.Description,
  };
}

// Sponsor rows come from the joined SponsorProfile+SponsorTiers+
// EventParticipant query in store.js's getSponsorsForEvent.
export function serializeSponsor(row) {
  if (!row) return null;
  return {
    id: row.SponsorProfileId,
    eventId: row.EventId,
    contactPersonId: row.ContactPersonId || '',
    name: row.CompanyName,
    tier: row.TierName ? `${row.TierName} Sponsor` : 'Sponsor',
    tierName: row.TierName || '',
    logoUrl: row.LogoUrl || '',
    description: row.Description || '',
    bannerUrl: row.BannerUrl || '',
    websiteUrl: row.WebsiteUrl || '',
    videoUrl: row.VideoUrl || '',
    videoThumbnailUrl: row.VideoThumbnailUrl || '',
    videoEmbedCode: row.VideoEmbedCode || '',
    linkedInUrl: row.LinkedInUrl || '',
    twitterHandle: row.TwitterHandle || '',
    views: row.VisitCount || 0,
    createdAt: row.CreatedAt,
  };
}

export function serializeAdminNavNode(node) {
  return {
    key: node.Key,
    label: node.Label,
    icon: node.Icon,
    isSection: node.IsSection,
    badge: node.Badge,
    children: (node.children || []).map(serializeAdminNavNode),
  };
}

export function serializePortalNavNode(node) {
  return {
    key: node.Key,
    label: node.Label,
    icon: node.Icon,
    route: node.Route,
    badgeCount: node.BadgeCount,
    children: (node.children || []).map(serializePortalNavNode),
  };
}

export function serializeWebsiteTheme(row) {
  if (!row) return null;
  return {
    speakerPageBannerPattern: row.SpeakerPageBannerPattern || 'Gradient',
    speakerCardStyle: row.SpeakerCardStyle || 'FullWidth',
    speakerGridColumns: Number(row.SpeakerGridColumns) || 4,
    updatedAt: row.UpdatedAt,
  };
}

export function serializeResourceItem(row) {
  return {
    id: row.PortalNavItemId,
    key: row.Key,
    label: row.Label,
    icon: row.Icon,
    route: row.Route,
    sortOrder: row.SortOrder,
    isVisible: row.IsVisible,
    isBuiltIn: row.IsBuiltIn,
  };
}

function toIsoOrNull(value) {
  if (!value) return null;
  // Same root cause as toDateStr above: db.js now returns raw
  // strings (e.g. "2026-10-01T09:00:00") for timestamp-without-
  // timezone columns, with no conversion. Appending "Z" marks that
  // wall-clock value as UTC explicitly, so every consumer — this
  // server, the frontend, any timezone — reads back the exact same
  // stored time rather than a value shifted by whatever machine
  // happens to be running the code.
  if (typeof value === 'string') {
    return value.includes('Z') ? value : `${value}Z`;
  }
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

export function serializeSession(row) {
  if (!row) return null;
  return {
    id: row.SessionId,
    eventId: row.EventId,
    trackId: row.TrackId,
    categoryId: row.CategoryId,
    formatId: row.FormatId,
    title: row.Title,
    shortDescription: row.ShortDescription || '',
    description: row.Description || '',
    learningObjectives: row.LearningObjectives || '',
    sessionType: row.SessionType,
    status: row.Status,
    startTime: toIsoOrNull(row.StartTime),
    endTime: toIsoOrNull(row.EndTime),
    location: row.Location || '',
    virtualRoomUrl: row.VirtualRoomUrl || '',
    maxAttendees: row.MaxAttendees,
    currentAttendees: row.CurrentAttendees,
    isLivestream: row.IsLivestream,
    isRecorded: row.IsRecorded,
    isOnDemand: row.IsOnDemand,
    recordingUrl: row.RecordingUrl || '',
    slideUrl: row.SlideUrl || '',
    thumbnailUrl: row.ThumbnailUrl || '',
    streamUrl: row.StreamUrl || '',
    streamEmbedCode: row.StreamEmbedCode || '',
    chatEnabled: row.ChatEnabled,
    qaEnabled: row.QaEnabled,
    pollsEnabled: row.PollsEnabled,
    requiresModeration: row.RequiresModeration,
    moderatorId: row.ModeratorId,
    averageRating: row.AverageRating,
    totalRatings: row.TotalRatings,
    tags: row.Tags || '',
    sortOrder: row.SortOrder,
    isPrivate: row.IsPrivate,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

export function serializeTrack(row) {
  return {
    id: row.TrackId,
    eventId: row.EventId,
    name: row.Name,
    description: row.Description || '',
    color: row.Color || '#7c3aed',
    icon: row.Icon || '',
    sortOrder: row.SortOrder,
    isActive: row.IsActive,
    sessionCount: row.SessionCount ?? 0,
  };
}

export function serializeSessionFormat(row) {
  return {
    id: row.FormatId,
    name: row.Name,
    description: row.Description || '',
    defaultDuration: row.DefaultDuration,
    icon: row.Icon || '',
  };
}

export function serializeSessionSpeaker(row) {
  return {
    speakerProfileId: row.SpeakerProfileId,
    name: row.FullName,
    role: row.Role,
    sortOrder: row.SortOrder,
  };
}

export function serializeSpeakerRosterEntry(row) {
  return {
    speakerProfileId: row.SpeakerProfileId,
    name: row.FullName,
  };
}

export function serializeSessionDocument(row) {
  return {
    id: row.DocumentId,
    sessionId: row.SessionId,
    title: row.Title,
    fileUrl: row.FileUrl,
    fileType: row.FileType,
    fileSizeKb: row.FileSizeKB,
    sortOrder: row.SortOrder,
  };
}

export function serializeSessionPoll(row) {
  return {
    id: row.PollId,
    sessionId: row.SessionId,
    question: row.Question,
    description: row.Description || '',
    pollType: row.PollType,
    isAnonymous: row.IsAnonymous,
    allowMultipleAnswers: row.AllowMultipleAnswers,
    isActive: row.IsActive,
    totalResponses: row.TotalResponses,
  };
}

export function serializeSessionStream(row) {
  return {
    id: row.StreamId,
    sessionId: row.SessionId,
    streamType: row.StreamType,
    streamUrl: row.StreamUrl || '',
    embedCode: row.EmbedCode || '',
    status: row.Status,
  };
}

export function serializeSessionSponsor(row) {
  return {
    id: row.SessionSponsorId,
    sessionId: row.SessionId,
    sponsorProfileId: row.SponsorProfileId,
    companyName: row.CompanyName,
    logoUrl: row.LogoUrl || '',
    sortOrder: row.SortOrder,
  };
}

export function serializeSessionTag(row) {
  return {
    id: row.SessionTagId,
    eventId: row.EventId,
    name: row.Name,
    color: row.Color || '#6366f1',
    isSystemTag: row.IsSystemTag,
  };
}

export function serializeSessionAuthor(row) {
  return {
    id: row.SessionAuthorId,
    sessionId: row.SessionId,
    firstName: row.FirstName,
    lastName: row.LastName,
    email: row.Email || '',
    affiliation: row.Affiliation || '',
    sortOrder: row.SortOrder,
  };
}

export function serializeCategory(row) {
  return {
    id: row.CategoryId,
    eventId: row.EventId,
    name: row.Name,
    color: row.Color || '#7c3aed',
    sortOrder: row.SortOrder,
    sessionCount: row.SessionCount ?? 0,
  };
}

export function serializeSpeakerCenterEntry(row) {
  let agendaSessions = row.AgendaSessions || [];
  if (typeof agendaSessions === 'string') {
    try { agendaSessions = JSON.parse(agendaSessions); } catch { agendaSessions = []; }
  }
  return {
    speakerProfileId: row.SpeakerProfileId,
    personId: row.PersonId,
    firstName: row.FirstName,
    lastName: row.LastName,
    name: row.FullName,
    email: row.Email,
    company: row.Company || '',
    jobTitle: row.JobTitle || '',
    country: row.Country || '',
    profilePictureUrl: row.ProfilePictureUrl || '',
    profilePictureThumbnailUrl: row.ProfilePictureThumbnailUrl || '',
    bio: row.ShortBio || '',
    sortOrder: row.SortOrder,
    speakerInformationFormLink: row.SpeakerInformationFormLink || '',
    linkedInUrl: row.LinkedInUrl || '',
    twitterUrl: row.TwitterUrl || '',
    instagramUrl: row.InstagramUrl || '',
    facebookUrl: row.FacebookUrl || '',
    agendaSessions,
  };
}


export function serializeExhibitor(row) {
  return {
    id: row.ExhibitorProfileId,
    eventId: row.EventId,
    company: row.CompanyName,
    description: row.Description || '',
    logoUrl: row.LogoUrl || '',
    boothNumber: row.BoothNumber || '',
    slogan: row.Slogan || '',
    address: row.Address || '',
    website: row.WebsiteUrl || '',
    videoUrl: row.VideoUrl || '',
    photoUrl: row.PhotoUrl || '',
    videoThumbnailUrl: row.VideoThumbnailUrl || '',
    contactEmail: row.ContactEmail || '',
    contactName: row.ContactName || '',
    contactPhone: row.ContactPhone || '',
    secondaryContactEmail: row.SecondaryContactEmail || '',
    secondaryContactName: row.SecondaryContactName || '',
    secondaryContactPhone: row.SecondaryContactPhone || '',
    sortOrder: row.SortOrder,
  };
}

export function serializeExhibitorCategory(row) {
  return {
    id: row.ExhibitorCategoryId,
    name: row.Name,
    sortOrder: row.SortOrder,
  };
}

export function serializeEventDocument(row) {
  return {
    id: row.DocumentId,
    title: row.Title,
    fileUrl: row.FileUrl,
    fileType: row.FileType,
    fileSizeKb: row.FileSizeKB,
    downloadCount: row.DownloadCount,
    sortOrder: row.SortOrder,
    sessionTitle: row.SessionTitle || null,
  };
}

export function serializeEventVideo(row) {
  return {
    id: row.EventVideoId,
    title: row.Title,
    fileUrl: row.FileUrl,
    fileSizeKb: row.FileSizeKB,
    viewCount: row.ViewCount,
    createdAt: row.CreatedAt,
  };
}

export function serializeTicketTypeVideoAccess(row) {
  return {
    id: row.TicketTypeId,
    name: row.Name,
    hasVideoAccess: row.HasVideoAccess,
  };
}

export function serializePublicSpeaker(row) {
  return {
    id: row.SpeakerProfileId,
    personId: row.PersonId || '',
    name: row.FullName,
    firstName: row.FirstName,
    lastName: row.LastName,
    company: row.Company || '',
    jobTitle: row.JobTitle || '',
    country: row.Country || '',
    bio: row.ShortBio || '',
    photoUrl: row.ProfilePictureUrl || '',
    photoThumbnailUrl: row.ProfilePictureThumbnailUrl || '',
    isKeynote: row.IsKeynote,
    isFeatured: row.IsFeatured,
    linkedInUrl: row.LinkedInUrl || '',
    twitterUrl: row.TwitterUrl || '',
    instagramUrl: row.InstagramUrl || '',
    facebookUrl: row.FacebookUrl || '',
    sortOrder: row.SortOrder,
  };
}
