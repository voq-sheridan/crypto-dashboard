// Select the table body where we’ll put coin data
const tbody = document.querySelector("#coins tbody");

// Function to load data from CoinGecko
async function loadCoins() {
  try {
    // API endpoint: top 10 coins in USD
    const url = "https://api.coingecko.com/api/v3/coins/markets" +
      "?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false";

    // Fetch data
    const response = await fetch(url);
    const data = await response.json();

    // Clear old rows
    tbody.innerHTML = "";

    // Loop through each coin and add to table
    data.forEach((coin) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${coin.market_cap_rank}</td>
        <td>${coin.name} (${coin.symbol.toUpperCase()})</td>
        <td>${coin.current_price}</td>
        <td>${coin.price_change_percentage_24h}</td>
        <td>${coin.market_cap}</td>
      `;

      tbody.appendChild(row);
    });

  } catch (error) {
    console.error("Error fetching data:", error);
    tbody.innerHTML = "<tr><td colspan='5'>Failed to load data</td></tr>";
  }
}

// Run the function once the page loads
loadCoins();

