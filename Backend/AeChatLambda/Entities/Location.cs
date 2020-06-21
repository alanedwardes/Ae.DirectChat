using MaxMind.GeoIP2.Responses;
using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
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

        [DataMember(Name = "cityName")]
        public string CityName { get; }
        [DataMember(Name = "countryName")]
        public string CountryName { get; }
        [DataMember(Name = "countryCode")]
        public string CountryCode { get; }
        [DataMember(Name = "continentName")]
        public string ContinentName { get; }
        [DataMember(Name = "subdivisionName")]
        public string SubdivisionName { get; }
    }
}
