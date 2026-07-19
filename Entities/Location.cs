using MaxMind.GeoIP2.Responses;
using System.Text.Json.Serialization;

namespace AeChat.Entities
{
    public sealed class Location
    {
        public Location(CityResponse cityResponse)
        {
            CityName = cityResponse.City.Name;
            CountryName = cityResponse.Country.Name;
            CountryCode = cityResponse.Country.IsoCode;
            ContinentName = cityResponse.Continent.Name;
            SubdivisionName = cityResponse.MostSpecificSubdivision.Name;
        }

        [JsonPropertyName("cityName")]
        public string CityName { get; }
        [JsonPropertyName("countryName")]
        public string CountryName { get; }
        [JsonPropertyName("countryCode")]
        public string CountryCode { get; }
        [JsonPropertyName("continentName")]
        public string ContinentName { get; }
        [JsonPropertyName("subdivisionName")]
        public string SubdivisionName { get; }
    }
}
