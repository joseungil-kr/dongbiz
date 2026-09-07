const placeId = process.argv[2] || '2058645213';

async function fetchPlaceGraphQL(id) {
  const url = 'https://api.place.naver.com/graphql';

  const body = [
    {
      operationName: "getPlaceFullSummary",
      variables: {
        input: {
          businessId: id,
          deviceType: "mobile"
        }
      },
      query: `query getPlaceFullSummary($input: PlaceFullSummaryInput) {
        place(input: $input) {
          id
          name
          category
          description
          roadAddress
          address
          phone
          virtualPhone
          talktalkUrl
          bookingUrl
          reviewSettings {
            keyword
            blog
            cafe
          }
          visitorReviewsTotal
          visitorReviewsScore
          cafeBlogReviewsTotal
          keywords
        }
      }`
    }
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    console.log('GraphQL Result:', JSON.stringify(json, null, 2));
  } catch (e) {
    console.error('GraphQL 에러:', e.message);
  }
}

fetchPlaceGraphQL(placeId);
